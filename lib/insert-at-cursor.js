// 把一段文本插到当前光标处。上传剪贴板图片后可选地直接落进正在写的输入框，
// 省掉一次 Ctrl+V —— 手上正在写笔记时，切走去粘贴是最打断思路的一步。
//
// 这个模块会被注入到页面里跑（background 里 executeScript 动态 import），
// 所以只能依赖 DOM，不能引扩展 API。

// 能插文本的 input 类型。number 读 selectionStart 会抛，password / 文件选择
// 之类插一条图片链接也没意义，一律不碰。
const TEXT_INPUT_TYPES = new Set(['text', 'search', 'url', 'tel', 'email', '']);

export function isTextField(element) {
	const tag = String(element?.tagName ?? '').toUpperCase();
	if (tag === 'TEXTAREA') return true;
	if (tag !== 'INPUT') return false;
	return TEXT_INPUT_TYPES.has(String(element.type ?? 'text').toLowerCase());
}

function fireInput(element, text) {
	element.dispatchEvent(
		new InputEvent('input', { bubbles: true, composed: true, inputType: 'insertText', data: text }),
	);
}

function insertIntoTextField(field, text) {
	const start = field.selectionStart ?? field.value.length;
	const end = field.selectionEnd ?? start;
	if (typeof field.setRangeText === 'function') {
		// 走 setRangeText 而不是直接赋 value：React 把 value 的 setter 换掉了，
		// 直接赋值会连它内部记的旧值一起更新，onChange 认为没变化，输入框看着变了、
		// 组件状态还是空的
		field.setRangeText(text, start, end, 'end');
	} else {
		field.value = `${field.value.slice(0, start)}${text}${field.value.slice(end)}`;
		field.selectionStart = field.selectionEnd = start + text.length;
	}
	fireInput(field, text);
	return true;
}

function insertIntoContentEditable(text, doc) {
	// execCommand 是废弃 API，但仍然是唯一能进浏览器撤销栈、并让富文本编辑器
	// 按自己的逻辑接住这次输入的插入方式，优先用它
	try {
		if (doc.execCommand?.('insertText', false, text)) return true;
	} catch {
		// 某些编辑器把 execCommand 拦掉了，退回 Selection API
	}

	const selection = doc.getSelection?.();
	if (!selection?.rangeCount) return false;
	const range = selection.getRangeAt(0);
	range.deleteContents();
	const node = doc.createTextNode(text);
	range.insertNode(node);
	range.setStartAfter(node);
	range.collapse(true);
	selection.removeAllRanges();
	selection.addRange(range);
	fireInput(doc.activeElement, text);
	return true;
}

/**
 * 插到光标处，成功返回 true。
 * 会被注入到页面的每个 frame，所以先用 hasFocus() 认领：只有真正持有焦点的那个
 * frame 才插，父文档里 activeElement 是 <iframe> 本身，插进去只会插错地方。
 */
export function insertAtCursor(text, doc = globalThis.document) {
	if (!text || !doc?.hasFocus?.()) return false;
	const target = doc.activeElement;
	if (isTextField(target)) return insertIntoTextField(target, text);
	if (target?.isContentEditable) return insertIntoContentEditable(text, doc);
	return false;
}
