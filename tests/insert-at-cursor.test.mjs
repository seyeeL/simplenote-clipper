import test from 'node:test';
import assert from 'node:assert/strict';

import { insertAtCursor, isTextField } from '../lib/insert-at-cursor.js';

class FakeInputEvent {
	constructor(type, init = {}) {
		this.type = type;
		this.inputType = init.inputType;
		this.data = init.data;
		this.bubbles = Boolean(init.bubbles);
	}
}
globalThis.InputEvent ??= FakeInputEvent;

function fakeField({ tagName = 'TEXTAREA', type, value = '', start = value.length, end = start } = {}) {
	const field = {
		tagName,
		type,
		value,
		selectionStart: start,
		selectionEnd: end,
		events: [],
		setRangeText(text, from, to) {
			this.value = `${this.value.slice(0, from)}${text}${this.value.slice(to)}`;
			this.selectionStart = this.selectionEnd = from + text.length;
		},
		dispatchEvent(event) {
			this.events.push(event);
			return true;
		},
	};
	return field;
}

function fakeDoc(activeElement, { focused = true, execCommand } = {}) {
	return {
		activeElement,
		hasFocus: () => focused,
		execCommand,
	};
}

test('只认能插文本的输入框', () => {
	assert.equal(isTextField({ tagName: 'TEXTAREA' }), true);
	assert.equal(isTextField({ tagName: 'input', type: 'text' }), true);
	assert.equal(isTextField({ tagName: 'INPUT' }), true); // 没写 type 就是 text
	assert.equal(isTextField({ tagName: 'INPUT', type: 'search' }), true);
	// number 读 selectionStart 会抛，password / checkbox 插链接也没意义
	assert.equal(isTextField({ tagName: 'INPUT', type: 'number' }), false);
	assert.equal(isTextField({ tagName: 'INPUT', type: 'password' }), false);
	assert.equal(isTextField({ tagName: 'INPUT', type: 'checkbox' }), false);
	assert.equal(isTextField({ tagName: 'DIV' }), false);
	assert.equal(isTextField(null), false);
});

test('插到光标处，替换选中内容并把光标移到插入内容之后', () => {
	const field = fakeField({ value: '前XX后', start: 1, end: 3 });
	const link = '![](https://img.example.com/a.png)';

	assert.equal(insertAtCursor(link, fakeDoc(field)), true);
	assert.equal(field.value, `前${link}后`);
	assert.equal(field.selectionStart, 1 + link.length);
	assert.equal(field.selectionEnd, 1 + link.length);
	// React/Vue 只认事件，不看 value 被谁改了；不派事件的话组件状态还是空的
	assert.equal(field.events.length, 1);
	assert.equal(field.events[0].type, 'input');
	assert.equal(field.events[0].inputType, 'insertText');
	assert.equal(field.events[0].data, link);
});

test('contenteditable 走 execCommand，进浏览器撤销栈', () => {
	const editor = { tagName: 'DIV', isContentEditable: true, dispatchEvent: () => true };
	const calls = [];
	const doc = fakeDoc(editor, {
		execCommand: (...args) => {
			calls.push(args);
			return true;
		},
	});

	assert.equal(insertAtCursor('链接', doc), true);
	assert.deepEqual(calls, [['insertText', false, '链接']]);
});

test('execCommand 被编辑器拦掉时退回 Selection API', () => {
	const editor = { tagName: 'DIV', isContentEditable: true, events: [], dispatchEvent(e) { this.events.push(e); return true; } };
	const range = {
		deleted: false,
		inserted: null,
		deleteContents() {
			this.deleted = true;
		},
		insertNode(node) {
			this.inserted = node;
		},
		setStartAfter() {},
		collapse() {},
	};
	const selection = { rangeCount: 1, getRangeAt: () => range, removeAllRanges() {}, addRange() {} };
	const doc = {
		activeElement: editor,
		hasFocus: () => true,
		execCommand: () => {
			throw new Error('编辑器拦了 execCommand');
		},
		getSelection: () => selection,
		createTextNode: (text) => ({ text }),
	};

	assert.equal(insertAtCursor('链接', doc), true);
	assert.equal(range.deleted, true);
	assert.deepEqual(range.inserted, { text: '链接' });
	assert.equal(editor.events[0].type, 'input');
});

test('没有可插入的地方就什么都不做，交给剪贴板兜底', () => {
	// 焦点不在这个 frame：注入到所有 frame 时，父文档的 activeElement 是 <iframe>
	const field = fakeField({ value: '' });
	assert.equal(insertAtCursor('链接', fakeDoc(field, { focused: false })), false);
	assert.equal(field.value, '');

	// 光标在普通元素上
	assert.equal(insertAtCursor('链接', fakeDoc({ tagName: 'BODY' })), false);
	assert.equal(insertAtCursor('链接', fakeDoc(null)), false);
	// 没东西可插
	assert.equal(insertAtCursor('', fakeDoc(fakeField())), false);
});
