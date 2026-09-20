/**
 * Epic-Logik ohne REST-API.
 *
 * Datenmodell (Plugin-Daten, Scope = Karten-ID, Sichtbarkeit "shared"):
 *   Task-Karte: { owner: <eigene ID>, epic: <ID der Epic-Karte> | null, children: [...] }
 *   Epic-Karte: { owner: <eigene ID>, epic: ...,                        children: [<Task-IDs>] }
 *
 * "owner" dient der Kopie-Erkennung: Wird eine Karte kopiert, werden ihre Plugin-Daten
 * mitkopiert. Steht dort eine fremde owner-ID, ignorieren wir die Daten.
 *
 * Lesen/Schreiben fremder Karten per t.get(cardId, ...) / t.set(cardId, ...) funktioniert
 * nur innerhalb desselben Boards. Genau das ist gewollt (kein Board-übergreifendes Verhalten).
 */
(function (root, factory) {
	if (typeof module === 'object' && module.exports) {
		module.exports = factory();
	}
	else {
		root.EpicRel = factory();
	}
})(typeof self !== 'undefined' ? self : this, function () {
	'use strict';

	const CARD_FIELDS = ['id', 'name', 'shortLink', 'url', 'idList', 'closed', 'dueComplete', 'dateLastActivity'];
	const CACHE_TTL_MS = 5000;

	// Listen, die automatisch als "erledigt" gelten, solange keine eigene Auswahl gespeichert ist
	const DONE_LIST_REGEX = /\b(done|erledigt|fertig|abgeschlossen|complete|completed|geschlossen)\b/i;

	// ---------------------------------------------------------------------------------------
	// kleiner Cache, damit z. B. 100 Badges nicht 100x t.cards() auslösen
	// ---------------------------------------------------------------------------------------
	let cache = {};

	function cached(key, loader) {
		const hit = cache[key];
		const now = Date.now();
		if (hit && now - hit.time < CACHE_TTL_MS) {
			return hit.promise;
		}
		
		const promise = Promise.resolve().then(loader);
		cache[key] = {time: now, promise: promise};
		promise.catch(function () {
			if (cache[key] && cache[key].promise === promise) {
				delete cache[key];
			}
		});
		return promise;
	}

	function invalidate() {
		cache = {};
	}

	// ---------------------------------------------------------------------------------------
	// Lesen / Schreiben der Relationen
	// ---------------------------------------------------------------------------------------

	/**
	 * @param  {object} t
	 * @param  {string} cardId echte Karten-ID (nicht 'card')
	 * @return {Promise<{epic: string|null, children: string[]}>}
	 */
	async function readData(t, cardId) {
		let raw = null;
		try {
			raw = await t.get(cardId, 'shared');
		}
		catch (error) {
			// Karte existiert nicht (mehr) auf diesem Board
			raw = null;
		}
		raw = raw || {};
		
		// Kopie-Erkennung
		if (raw.owner !== cardId) {
			return {epic: null, children: []};
		}
		
		return {
			epic:     raw.epic || null,
			children: Array.isArray(raw.children) ? raw.children : [],
		};
	}

	function writeData(t, cardId, data) {
		return t.set(cardId, 'shared', {
			owner:    cardId,
			epic:     data.epic || null,
			children: data.children || [],
		});
	}

	/**
	 * alle Vorfahren (Epic, Epic des Epics, ...) einer Karte, über die Plugin-Daten
	 * 
	 * @return {Promise<string[]>}
	 */
	async function ancestorIds(t, cardId) {
		const found = [];
		const seen  = new Set([cardId]);
		let current = (await readData(t, cardId)).epic;
		
		while (current && !seen.has(current)) {
			found.push(current);
			seen.add(current);
			current = (await readData(t, current)).epic;
		}
		
		return found;
	}

	/**
	 * Epic einer Task setzen, wechseln (epicId) oder entfernen (epicId = null).
	 * Hält beide Seiten synchron: task.epic und epic.children.
	 */
	async function setEpic(t, taskId, epicId) {
		epicId = epicId || null;
		
		if (epicId === taskId) {
			throw new Error('Eine Karte kann nicht ihr eigener Epic sein.');
		}
		if (epicId && (await ancestorIds(t, epicId)).includes(taskId)) {
			throw new Error('Nicht möglich: Der gewählte Epic ist selbst Teil dieser Karte (Endlosschleife).');
		}
		
		const task = await readData(t, taskId);
		
		// aus altem Epic austragen
		if (task.epic && task.epic !== epicId) {
			try {
				const old = await readData(t, task.epic);
				await writeData(t, task.epic, {
					epic:     old.epic,
					children: old.children.filter(function (id) { return id !== taskId; }),
				});
			}
			catch (error) {
				// alter Epic wurde gelöscht — nichts mehr zu tun
			}
		}
		
		// in neuen Epic eintragen
		if (epicId) {
			const epic = await readData(t, epicId);
			const children = epic.children.includes(taskId) ? epic.children : epic.children.concat([taskId]);
			await writeData(t, epicId, {epic: epic.epic, children: children});
		}
		
		await writeData(t, taskId, {epic: epicId, children: task.children});
		invalidate();
	}

	/**
	 * Verknüpfungen zu Karten entfernen, die es nicht mehr gibt (gelöscht)
	 */
	async function pruneMissing(t, epicId, existingIds) {
		const data = await readData(t, epicId);
		const keep = new Set(existingIds);
		await writeData(t, epicId, {
			epic:     data.epic,
			children: data.children.filter(function (id) { return keep.has(id); }),
		});
		invalidate();
	}

	// ---------------------------------------------------------------------------------------
	// Board-Daten (t.cards() & Co.)
	// ---------------------------------------------------------------------------------------

	function getCards(t) {
		return cached('cards', function () {
			return t.cards.apply(t, CARD_FIELDS);
		});
	}

	/**
	 * @return {Promise<Map<string, {epic: string|null, children: string[]}>>}
	 */
	function getRelations(t) {
		return cached('relations', async function () {
			const cards   = await getCards(t);
			const entries = await Promise.all(cards.map(async function (card) {
				return [card.id, await readData(t, card.id)];
			}));
			return new Map(entries);
		});
	}

	async function getCardsAndRelations(t) {
		return Promise.all([getCards(t), getRelations(t)]);
	}

	/**
	 * @return {Promise<function(card): boolean>}
	 */
	async function getDoneChecker(t) {
		const results = await Promise.all([
			cached('doneListIds', function () { return t.get('board', 'shared', 'doneListIds'); }),
			cached('lists',       function () { return t.lists('id', 'name'); }),
		]);
		const savedIds = results[0];
		const lists    = results[1];
		
		let doneListIds;
		if (Array.isArray(savedIds)) {
			doneListIds = new Set(savedIds);
		}
		else {
			doneListIds = new Set(lists.filter(function (list) {
				return DONE_LIST_REGEX.test(list.name);
			}).map(function (list) {
				return list.id;
			}));
		}
		
		return function isDone(card) {
			return card.closed === true || card.dueComplete === true || doneListIds.has(card.idList);
		};
	}

	// ---------------------------------------------------------------------------------------
	// Fortschritt
	// ---------------------------------------------------------------------------------------

	/**
	 * @param  {string[]}                childIds
	 * @param  {Map<string, object>}     cardsById
	 * @param  {function(object): bool}  isDone
	 */
	function computeProgress(childIds, cardsById, isDone) {
		const items   = [];
		const missing = [];
		
		childIds.forEach(function (id) {
			const card = cardsById.get(id);
			if (card === undefined) {
				missing.push(id);
				return;
			}
			items.push({card: card, done: isDone(card)});
		});
		
		const done = items.filter(function (item) { return item.done; }).length;
		
		return {
			total:   items.length,
			done:    done,
			percent: items.length === 0 ? 0 : Math.round(done / items.length * 100),
			items:   items,
			missing: missing,
		};
	}

	async function getProgress(t, epicId, data) {
		data = data || await readData(t, epicId);
		const results = await Promise.all([getCards(t), getDoneChecker(t)]);
		const cardsById = new Map(results[0].map(function (card) { return [card.id, card]; }));
		return computeProgress(data.children, cardsById, results[1]);
	}

	// ---------------------------------------------------------------------------------------
	// Suche für die Popups (reine Funktionen, gut testbar)
	// ---------------------------------------------------------------------------------------

	function ancestorsOf(relations, cardId) {
		const found = [];
		const seen  = new Set([cardId]);
		const first = relations.get(cardId);
		let current = first ? first.epic : null;
		
		while (current && !seen.has(current)) {
			found.push(current);
			seen.add(current);
			const next = relations.get(current);
			current = next ? next.epic : null;
		}
		return found;
	}

	function descendantsOf(relations, cardId) {
		const found = new Set();
		const queue = [cardId];
		
		while (queue.length > 0) {
			const next = relations.get(queue.shift());
			if (!next) {
				continue;
			}
			next.children.forEach(function (childId) {
				if (!found.has(childId) && childId !== cardId) {
					found.add(childId);
					queue.push(childId);
				}
			});
		}
		return Array.from(found);
	}

	function byActivityDesc(a, b) {
		return (b.card.dateLastActivity || '').localeCompare(a.card.dateLastActivity || '');
	}

	function matchesSearch(card, search) {
		return search === '' || card.name.toLowerCase().indexOf(search) !== -1;
	}

	/**
	 * Kandidaten für "Task zu diesem Epic hinzufügen"
	 * 
	 * @return {{card: object, currentEpic: object|null}[]}
	 */
	function candidateTasksFor(epicId, cards, relations, search, limit) {
		search = String(search || '').trim().toLowerCase();
		
		const own      = relations.get(epicId) || {epic: null, children: []};
		const excluded = new Set([epicId].concat(ancestorsOf(relations, epicId), own.children));
		const byId     = new Map(cards.map(function (card) { return [card.id, card]; }));
		
		return cards
			.filter(function (card) { return !excluded.has(card.id) && matchesSearch(card, search); })
			.map(function (card) {
				const relation = relations.get(card.id);
				return {
					card:        card,
					currentEpic: (relation && relation.epic && byId.get(relation.epic)) || null,
				};
			})
			.sort(byActivityDesc)
			.slice(0, limit || 30);
	}

	/**
	 * Kandidaten für "Epic für diese Task wählen". Karten, die bereits Tasks haben, stehen vorne.
	 * 
	 * @return {{card: object, childCount: number}[]}
	 */
	function candidateEpicsFor(taskId, cards, relations, search, limit) {
		search = String(search || '').trim().toLowerCase();
		
		const own      = relations.get(taskId) || {epic: null, children: []};
		const excluded = new Set([taskId].concat(descendantsOf(relations, taskId)));
		if (own.epic) {
			excluded.add(own.epic);
		}
		
		return cards
			.filter(function (card) { return !excluded.has(card.id) && matchesSearch(card, search); })
			.map(function (card) {
				const relation = relations.get(card.id);
				return {card: card, childCount: relation ? relation.children.length : 0};
			})
			.sort(function (a, b) {
				const epicOrder = (b.childCount > 0) - (a.childCount > 0);
				return epicOrder !== 0 ? epicOrder : byActivityDesc(a, b);
			})
			.slice(0, limit || 30);
	}

	function shortName(name, max) {
		max = max || 24;
		return name.length > max ? name.substring(0, max - 1) + '…' : name;
	}

	return {
		DONE_LIST_REGEX:       DONE_LIST_REGEX,
		invalidate:            invalidate,
		readData:              readData,
		writeData:             writeData,
		ancestorIds:           ancestorIds,
		setEpic:               setEpic,
		pruneMissing:          pruneMissing,
		getCards:              getCards,
		getRelations:          getRelations,
		getCardsAndRelations:  getCardsAndRelations,
		getDoneChecker:        getDoneChecker,
		computeProgress:       computeProgress,
		getProgress:           getProgress,
		ancestorsOf:           ancestorsOf,
		descendantsOf:         descendantsOf,
		candidateTasksFor:     candidateTasksFor,
		candidateEpicsFor:     candidateEpicsFor,
		shortName:             shortName,
	};
});
