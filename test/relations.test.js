const test   = require('node:test');
const assert = require('node:assert/strict');
const Rel    = require('../js/relations.js');

/**
 * minimaler Ersatz für das Trello-t-Objekt
 */
function makeT(cards, options = {}) {
	const known = new Set(cards.map((c) => c.id));
	const store = new Map();
	const lists = options.lists || [
		{id: 'todo', name: 'To Do'},
		{id: 'doing', name: 'In Arbeit'},
		{id: 'done', name: 'Done ✅'},
	];
	const slot = (scope, visibility) => {
		if (scope !== 'board' && !known.has(scope)) {
			throw new Error('Card not found or not on current board (Command: data)');
		}
		return scope + '|' + visibility;
	};
	
	return {
		cards: async () => cards.map((c) => ({...c})),
		lists: async () => lists,
		get: async (scope, visibility, key, fallback) => {
			const data = store.get(slot(scope, visibility)) || {};
			if (key === undefined) {
				return {...data};
			}
			return data[key] !== undefined ? data[key] : fallback;
		},
		set: async (scope, visibility, keyOrObject, value) => {
			const name = slot(scope, visibility);
			const data = store.get(name) || {};
			store.set(name, typeof keyOrObject === 'object' ? {...data, ...keyOrObject} : {...data, [keyOrObject]: value});
		},
		_store: store,
	};
}

const CARDS = [
	{id: 'e1', name: 'Website Relaunch', idList: 'doing', dateLastActivity: '2026-09-01'},
	{id: 'e2', name: 'Marketing',        idList: 'doing', dateLastActivity: '2026-09-02'},
	{id: 'a',  name: 'Design Startseite', idList: 'done', dateLastActivity: '2026-09-03'},
	{id: 'b',  name: 'Texte schreiben',   idList: 'doing', dateLastActivity: '2026-09-04'},
	{id: 'c',  name: 'Hosting einrichten', idList: 'todo', dateLastActivity: '2026-09-05'},
	{id: 'd',  name: 'Logo',              idList: 'todo', dateLastActivity: '2026-09-06', dueComplete: true},
];

test.beforeEach(() => Rel.invalidate());

test('setEpic verknüpft beide Seiten', async () => {
	const t = makeT(CARDS);
	await Rel.setEpic(t, 'a', 'e1');
	await Rel.setEpic(t, 'b', 'e1');
	
	assert.equal((await Rel.readData(t, 'a')).epic, 'e1');
	assert.deepEqual((await Rel.readData(t, 'e1')).children, ['a', 'b']);
});

test('doppeltes Zuweisen erzeugt keine Duplikate', async () => {
	const t = makeT(CARDS);
	await Rel.setEpic(t, 'a', 'e1');
	await Rel.setEpic(t, 'a', 'e1');
	assert.deepEqual((await Rel.readData(t, 'e1')).children, ['a']);
});

test('Epic wechseln trägt die Task aus dem alten Epic aus', async () => {
	const t = makeT(CARDS);
	await Rel.setEpic(t, 'a', 'e1');
	await Rel.setEpic(t, 'a', 'e2');
	
	assert.deepEqual((await Rel.readData(t, 'e1')).children, []);
	assert.deepEqual((await Rel.readData(t, 'e2')).children, ['a']);
	assert.equal((await Rel.readData(t, 'a')).epic, 'e2');
});

test('Epic entfernen (null)', async () => {
	const t = makeT(CARDS);
	await Rel.setEpic(t, 'a', 'e1');
	await Rel.setEpic(t, 'a', null);
	
	assert.equal((await Rel.readData(t, 'a')).epic, null);
	assert.deepEqual((await Rel.readData(t, 'e1')).children, []);
});

test('Endlosschleifen und Selbstverweis werden verhindert', async () => {
	const t = makeT(CARDS);
	await Rel.setEpic(t, 'e2', 'e1');            // e1 > e2
	await Rel.setEpic(t, 'a', 'e2');             // e1 > e2 > a
	
	await assert.rejects(() => Rel.setEpic(t, 'e1', 'a'),  /Endlosschleife/);
	await assert.rejects(() => Rel.setEpic(t, 'e1', 'e2'), /Endlosschleife/);
	await assert.rejects(() => Rel.setEpic(t, 'a', 'a'),   /eigener Epic/);
});

test('Kopie-Erkennung: fremde owner-ID wird ignoriert', async () => {
	const t = makeT(CARDS);
	await t.set('b', 'shared', {owner: 'a', epic: 'e1', children: ['c']}); // wie eine kopierte Karte
	
	assert.deepEqual(await Rel.readData(t, 'b'), {epic: null, children: []});
});

test('Fortschritt: Done-Liste (Namens-Heuristik), dueComplete und fehlende Karten', async () => {
	const t = makeT(CARDS);
	for (const id of ['a', 'b', 'c', 'd']) {
		await Rel.setEpic(t, id, 'e1');
	}
	// eine Task ist inzwischen gelöscht
	const data = await Rel.readData(t, 'e1');
	await Rel.writeData(t, 'e1', {epic: null, children: data.children.concat(['gone'])});
	Rel.invalidate();
	
	const progress = await Rel.getProgress(t, 'e1');
	assert.equal(progress.total, 4);
	assert.equal(progress.done, 2);        // a (Liste "Done ✅") + d (dueComplete)
	assert.equal(progress.percent, 50);
	assert.deepEqual(progress.missing, ['gone']);
});

test('Fortschritt: gespeicherte Done-Listen überschreiben die Heuristik', async () => {
	const t = makeT(CARDS);
	for (const id of ['a', 'b']) {
		await Rel.setEpic(t, id, 'e1');
	}
	await t.set('board', 'shared', 'doneListIds', ['doing']);
	Rel.invalidate();
	
	const progress = await Rel.getProgress(t, 'e1');
	assert.equal(progress.done, 1);        // nur b (In Arbeit), a liegt in "Done ✅" und zählt nicht mehr
});

test('Fortschritt ohne Tasks', async () => {
	const t = makeT(CARDS);
	const progress = await Rel.getProgress(t, 'e1');
	assert.deepEqual([progress.total, progress.done, progress.percent], [0, 0, 0]);
});

test('pruneMissing entfernt nur nicht mehr vorhandene Karten', async () => {
	const t = makeT(CARDS);
	await Rel.setEpic(t, 'a', 'e1');
	await Rel.writeData(t, 'e1', {epic: null, children: ['a', 'gone']});
	await Rel.pruneMissing(t, 'e1', CARDS.map((c) => c.id));
	assert.deepEqual((await Rel.readData(t, 'e1')).children, ['a']);
});

test('candidateTasksFor: schließt Epic, Vorfahren und bestehende Tasks aus', async () => {
	const t = makeT(CARDS);
	await Rel.setEpic(t, 'e2', 'e1');            // e1 > e2
	await Rel.setEpic(t, 'a', 'e2');             // e2 hat Task a
	await Rel.setEpic(t, 'b', 'e1');             // b ist in e1
	Rel.invalidate();
	
	const [cards, relations] = await Rel.getCardsAndRelations(t);
	const names = (list) => list.map((item) => item.card.id);
	
	// für e2: nicht e2 selbst, nicht Vorfahre e1, nicht die eigene Task a
	assert.deepEqual(names(Rel.candidateTasksFor('e2', cards, relations, '', 30)).sort(), ['b', 'c', 'd']);
	
	// Suche + Hinweis auf aktuellen Epic
	const found = Rel.candidateTasksFor('e2', cards, relations, 'TEXTE', 30);
	assert.equal(found.length, 1);
	assert.equal(found[0].card.id, 'b');
	assert.equal(found[0].currentEpic.id, 'e1');
	
	// neueste Aktivität zuerst
	assert.deepEqual(names(Rel.candidateTasksFor('e2', cards, relations, '', 2)), ['d', 'c']);
});

test('candidateEpicsFor: Epics zuerst, keine Nachfahren, nicht der aktuelle Epic', async () => {
	const t = makeT(CARDS);
	await Rel.setEpic(t, 'a', 'e1');
	await Rel.setEpic(t, 'b', 'a');              // e1 > a > b
	Rel.invalidate();
	
	const [cards, relations] = await Rel.getCardsAndRelations(t);
	const ids = (list) => list.map((item) => item.card.id);
	
	// für a: nicht a, nicht Nachfahre b, nicht aktueller Epic e1
	assert.deepEqual(ids(Rel.candidateEpicsFor('a', cards, relations, '', 30)).sort(), ['c', 'd', 'e2']);
	
	// für c: Karten mit Tasks (e1, a) stehen vorne
	const forC = ids(Rel.candidateEpicsFor('c', cards, relations, '', 30));
	assert.deepEqual(forC.slice(0, 2).sort(), ['a', 'e1']);
});
