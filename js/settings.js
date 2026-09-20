/* global TrelloPowerUp, EpicRel */
'use strict';

const t    = TrelloPowerUp.iframe();
const root = document.getElementById('root');

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

t.render(async function () {
	document.documentElement.dataset.theme = t.getContext().theme === 'dark' ? 'dark' : 'light';
	
	const results = await Promise.all([
		t.lists('id', 'name'),
		t.get('board', 'shared', 'doneListIds'),
	]);
	const lists    = results[0];
	const saved    = results[1];
	const isCustom = Array.isArray(saved);
	
	const selected = isCustom
		? new Set(saved)
		: new Set(lists.filter(function (list) { return EpicRel.DONE_LIST_REGEX.test(list.name); }).map(function (list) { return list.id; }));
	
	const boxes = lists.map(function (list) {
		const input = el('input', {type: 'checkbox', value: list.id});
		input.checked = selected.has(list.id);
		return {input: input, row: el('label', {class: 'check'}, [input, el('span', {text: list.name})])};
	});
	
	const save = function () {
		const ids = boxes.filter(function (box) { return box.input.checked; }).map(function (box) { return box.input.value; });
		return t.set('board', 'shared', 'doneListIds', ids).then(function () {
			EpicRel.invalidate();
			return t.closePopup();
		});
	};
	
	const reset = function () {
		return t.remove('board', 'shared', 'doneListIds').then(function () {
			EpicRel.invalidate();
			return t.closePopup();
		});
	};
	
	const actions = [
		el('button', {type: 'button', class: 'primary', text: 'Speichern', onclick: save}),
	];
	if (isCustom) {
		actions.push(el('button', {type: 'button', class: 'link muted', text: 'Automatisch erkennen', onclick: reset}));
	}
	
	root.replaceChildren(
		el('p', {class: 'muted', text: 'Tasks in diesen Listen zählen im Epic als erledigt (zusätzlich zu archivierten und als fällig-erledigt markierten Karten).'}),
		el('div', {}, boxes.map(function (box) { return box.row; })),
		el('div', {class: 'actions'}, actions)
	);
	
	return t.sizeTo('#root');
});
