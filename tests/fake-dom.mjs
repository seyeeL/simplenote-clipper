// html2md 只用 nodeType / nodeName / childNodes / getAttribute / textContent，
// 所以测试里手搓这五个字段就够，不用引 jsdom。

export function text(value) {
	return {
		nodeType: 3,
		nodeName: '#text',
		childNodes: [],
		textContent: String(value),
		getAttribute: () => null,
	};
}

export function el(name, attrs = {}, children = []) {
	const node = {
		nodeType: 1,
		nodeName: String(name).toUpperCase(),
		childNodes: children.map((c) => (typeof c === 'string' ? text(c) : c)),
		getAttribute: (key) => (key in attrs ? String(attrs[key]) : null),
	};
	Object.defineProperty(node, 'textContent', {
		get: () => node.childNodes.map((c) => c.textContent).join(''),
	});
	return node;
}
