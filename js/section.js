/* global TrelloPowerUp, EpicRel */
'use strict';

const t    = TrelloPowerUp.iframe();
const root = document.getElementById('root');

/**
 * kleiner DOM-Helfer. Kartennamen werden immer als Text gesetzt (kein innerHTML).
 */
function el(tag, props, children) {
	const node = document.createElement(tag);
	Object.keys(props || {}).forEach(function (key) {
		if (key === 'text') {
			node.textContent = props[key];
		}
		else if (key === 'class') {
			node.className = props[key];
		}
		else if (key.indexOf('on') === 0) {
			node.addEventListener(key.substring(2), props[key]);
		}
		else {
			node.setAttribute(key, props[key]);
		}
	});
	(children || []).forEach(function (child) {
		node.appendChild(child);
	});
	return node;
}

function linkButton(text, onClick, extraClass) {
	return el('button', {type: 'button', class: 'link ' + (extraClass || ''), text: text, onclick: onClick});
}

async function act(action) {
	try {
		await action();
	}
	catch (error) {
		t.alert({message: error.message, duration: 8, display: 'error'});
	}
	return render();
}

function renderProgress(progress) {
	const isComplete = progress.total > 0 && progress.done === progress.total;
	
	return el('div', {class: 'progress'}, [
		el('div', {class: 'progress__label'}, [
			el('span', {text: progress.done + ' von ' + progress.total + ' erledigt'}),
			el('span', {text: progress.percent + ' %'}),
		]),
		el('div', {class: 'progress__bar', role: 'progressbar', 'aria-valuenow': String(progress.percent), 'aria-valuemin': '0', 'aria-valuemax': '100'}, [
			el('div', {class: 'progress__fill' + (isComplete ? ' is-done' : ''), style: 'width:' + progress.percent + '%'}),
		]),
	]);
}

function renderTaskRow(item, listNames) {
	return el('li', {class: 'row' + (item.done ? ' is-done' : '')}, [
		el('span', {class: 'row__status', 'aria-hidden': 'true', text: item.done ? '✓' : '○'}),
		linkButton(item.card.name, function () { t.showCard(item.card.id); }, 'row__name'),
		el('span', {class: 'row__list', text: listNames.get(item.card.idList) || ''}),
		el('button', {
			type:         'button',
			class:        'icon',
			title:        'Aus Epic entfernen',
			'aria-label': 'Aus Epic entfernen: ' + item.card.name,
			text:         '✕',
			onclick:      function () { act(function () { return EpicRel.setEpic(t, item.card.id, null); }); },
		}),
	]);
}

async function render() {
	const context = t.getContext();
	document.documentElement.dataset.theme = context.theme === 'dark' ? 'dark' : 'light';
	
	EpicRel.invalidate();
	
	const cardId = context.card;
	const data   = await EpicRel.readData(t, cardId);
	const lists  = await t.lists('id', 'name');
	const cards  = await EpicRel.getCards(t);
	
	const listNames = new Map(lists.map(function (list) { return [list.id, list.name]; }));
	const nodes     = [];
	
	// Verweis auf den Epic dieser Karte
	if (data.epic) {
		const epic = cards.find(function (card) { return card.id === data.epic; });
		
		nodes.push(el('div', {class: 'parent'}, epic ? [
			el('span', {class: 'parent__label', text: 'Teil von Epic'}),
			linkButton(epic.name, function () { t.showCard(epic.id); }, 'parent__name'),
			linkButton('Entfernen', function () { act(function () { return EpicRel.setEpic(t, cardId, null); }); }, 'muted'),
		] : [
			el('span', {class: 'muted', text: 'Der zugewiesene Epic wurde nicht gefunden (gelöscht?).'}),
			linkButton('Entfernen', function () { act(function () { return EpicRel.setEpic(t, cardId, null); }); }, 'muted'),
		]));
	}
	
	// Fortschritt + Tasks dieses Epics
	if (data.children.length > 0) {
		const progress = await EpicRel.getProgress(t, cardId, data);
		nodes.push(renderProgress(progress));
		
		const rows = el('ul', {class: 'rows'});
		progress.items.forEach(function (item) {
			rows.appendChild(renderTaskRow(item, listNames));
		});
		nodes.push(rows);
		
		if (progress.missing.length > 0) {
			const existingIds = progress.items.map(function (item) { return item.card.id; });
			nodes.push(el('div', {class: 'notice'}, [
				el('span', {text: progress.missing.length + ' verknüpfte Karte(n) nicht gefunden (gelöscht?). '}),
				linkButton('Bereinigen', function () { act(function () { return EpicRel.pruneMissing(t, cardId, existingIds); }); }),
			]));
		}
		
		nodes.push(el('div', {class: 'notice', text: 'Erledigt = in einer Done-Liste, als fällig-erledigt markiert oder archiviert. Einstellbar über das Power-Up-Menü des Boards.'}));
	}
	
	root.replaceChildren.apply(root, nodes);
	return t.sizeTo('#root');
}

t.render(render);

// Fortschritt aktuell halten, wenn Tasks in andere Listen verschoben werden
setInterval(function () {
	render().catch(function () { /* nächster Versuch beim nächsten Intervall */ });
}, 20000);
