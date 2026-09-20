/* global TrelloPowerUp, EpicRel */
'use strict';

const absoluteUrl = function (path) {
	return new URL(path, window.location.href).href;
};

const ICON_EPIC  = absoluteUrl('./img/icon-epic.svg');
const ICON_TASKS = absoluteUrl('./img/icon-tasks.svg');

const SEARCH = {
	placeholder: 'Karte suchen …',
	empty:       'Keine passende Karte gefunden',
	searching:   'Suche …',
	debounce:    200,
	count:       30,
};

/**
 * Fehler des Vorgangs als Trello-Hinweis zeigen statt still zu scheitern
 */
async function runAndClose(t, action) {
	try {
		await action();
		return t.closePopup();
	}
	catch (error) {
		return t.alert({message: error.message, duration: 8, display: 'error'});
	}
}

/**
 * Popup auf einer Task: Epic (Parent) zuweisen, wechseln oder entfernen
 */
function showEpicPopup(t) {
	return t.popup({
		title:  'Epic zuweisen',
		search: SEARCH,
		items:  async function (t, options) {
			const taskId = t.getContext().card;
			const search = ((options && options.search) || '').trim();
			const result = await EpicRel.getCardsAndRelations(t);
			const cards  = result[0];
			const rel    = result[1];
			const items  = [];
			
			const current = rel.get(taskId) ? rel.get(taskId).epic : null;
			const currentCard = cards.find(function (card) { return card.id === current; });
			if (currentCard && search === '') {
				items.push({
					text:     '✕ Epic entfernen: ' + currentCard.name,
					callback: function (t) {
						return runAndClose(t, function () { return EpicRel.setEpic(t, taskId, null); });
					},
				});
			}
			
			EpicRel.candidateEpicsFor(taskId, cards, rel, search, SEARCH.count).forEach(function (candidate) {
				items.push({
					text:     candidate.card.name + (candidate.childCount > 0 ? '  ·  ' + candidate.childCount + ' Tasks' : ''),
					callback: function (t) {
						return runAndClose(t, function () { return EpicRel.setEpic(t, taskId, candidate.card.id); });
					},
				});
			});
			
			return items;
		},
	});
}

/**
 * Popup auf einem Epic: bestehende Karten des Boards als Task hinzufügen
 */
function showTaskPopup(t) {
	return t.popup({
		title:  'Task hinzufügen',
		search: SEARCH,
		items:  async function (t, options) {
			const epicId = t.getContext().card;
			const search = ((options && options.search) || '').trim();
			const result = await EpicRel.getCardsAndRelations(t);
			
			return EpicRel.candidateTasksFor(epicId, result[0], result[1], search, SEARCH.count).map(function (candidate) {
				const note = candidate.currentEpic ? '  ·  verschieben von „' + EpicRel.shortName(candidate.currentEpic.name, 20) + '“' : '';
				
				return {
					text:     candidate.card.name + note,
					callback: function (t) {
						return runAndClose(t, function () { return EpicRel.setEpic(t, candidate.card.id, epicId); });
					},
				};
			});
		},
	});
}

/**
 * Badges: Fortschritt am Epic, Epic-Name an der Task
 * 
 * @param {object}  t
 * @param {boolean} detail true = Rückseite der Karte, false = Vorderseite
 */
async function buildBadges(t, detail) {
	const cardId = t.getContext().card;
	const data   = await EpicRel.readData(t, cardId);
	const badges = [];
	
	if (data.children.length > 0) {
		const progress = await EpicRel.getProgress(t, cardId, data);
		
		if (progress.total > 0) {
			const color = (progress.done === progress.total) ? 'green' : undefined;
			const text  = progress.done + '/' + progress.total;
			
			badges.push(detail
				? {title: 'Tasks', text: text, color: color, refresh: 30}
				: {icon: ICON_TASKS, text: text + ' Tasks', color: color, refresh: 30}
			);
		}
	}
	
	if (data.epic) {
		const cards = await EpicRel.getCards(t);
		const epic  = cards.find(function (card) { return card.id === data.epic; });
		
		if (epic) {
			badges.push(detail
				? {title: 'Epic', text: epic.name, callback: function (t) { return t.showCard(epic.id); }}
				: {icon: ICON_EPIC, text: EpicRel.shortName(epic.name), color: 'purple', refresh: 30}
			);
		}
	}
	
	return badges;
}

TrelloPowerUp.initialize({
	'card-buttons': async function (t) {
		const data = await EpicRel.readData(t, t.getContext().card);
		
		return [
			{
				icon:      ICON_EPIC,
				text:      data.epic ? 'Epic ändern' : 'Epic zuweisen',
				condition: 'edit',
				callback:  showEpicPopup,
			},
			{
				icon:      ICON_TASKS,
				text:      'Tasks hinzufügen',
				condition: 'edit',
				callback:  showTaskPopup,
			},
		];
	},
	
	'card-badges': function (t) {
		return buildBadges(t, false);
	},
	
	'card-detail-badges': function (t) {
		return buildBadges(t, true);
	},
	
	// Abschnitt auf der Kartenrückseite: Fortschritt + Task-Liste (Epic) bzw. Verweis auf den Epic (Task)
	'card-back-section': async function (t) {
		const data = await EpicRel.readData(t, t.getContext().card);
		if (!data.epic && data.children.length === 0) {
			return null;
		}
		
		return {
			title:   data.children.length > 0 ? 'Epic-Fortschritt' : 'Epic',
			icon:    ICON_EPIC,
			content: {
				type:   'iframe',
				url:    t.signUrl('./section.html'),
				height: 140,
			},
		};
	},
	
	'show-settings': function (t) {
		return t.popup({
			title:  'Epic Tasks: Einstellungen',
			url:    './settings.html',
			height: 300,
		});
	},
}, {
	appName: 'Epic Tasks',
});
