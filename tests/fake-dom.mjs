// html2md 只用 nodeType / nodeName / childNodes / getAttribute / textContent，
// 所以测试里手搓这五个字段就够，不用引 jsdom。

export function text(value) {
	return {
		nodeType: 3,
		nodeName: '#text',
		childNodes: [],
		textContent: String(value),
		getAttribute: () => null,
		replaceWith,
	};
}

export function el(name, attrs = {}, children = []) {
	const node = {
		nodeType: 1,
		nodeName: String(name).toUpperCase(),
		childNodes: children.map((c) => (typeof c === 'string' ? text(c) : c)),
		getAttribute: (key) => (key in attrs ? String(attrs[key]) : null),
		replaceWith,
		appendChild,
	};
	Object.defineProperty(node, 'textContent', {
		get: () => node.childNodes.map((c) => c.textContent).join(''),
	});
	for (const child of node.childNodes) child.parentNode = node;
	return node;
}

function appendChild(child) {
	child.parentNode = this;
	this.childNodes.push(child);
	return child;
}

/** 把自己从父节点里换掉。传 fragment 就展开它的孩子，和真 DOM 一个语义。 */
function replaceWith(replacement) {
	const parent = this.parentNode;
	if (!parent) return;
	const incoming = replacement?.nodeType === 11 ? [...replacement.childNodes] : [replacement];
	for (const node of incoming) node.parentNode = parent;
	parent.childNodes.splice(parent.childNodes.indexOf(this), 1, ...incoming);
}

/**
 * extract.js 里改 DOM 的那几个函数（stripText / keepLineBreaks）比 html2md 多用
 * ownerDocument、createDocumentFragment、replaceWith。补齐这几个就能在 node 里测，
 * 不用为了两个函数起浏览器。
 */
export function fakeDoc() {
	const doc = {
		createElement: (name) => attach(el(name), doc),
		createTextNode: (value) => attach(text(value), doc),
		createDocumentFragment: () => {
			const frag = attach(el('#fragment'), doc);
			frag.nodeType = 11;
			return frag;
		},
		/** 给整棵树挂上 ownerDocument */
		adopt: (node) => attach(node, doc),
	};
	return doc;
}

function attach(node, doc) {
	node.ownerDocument = doc;
	for (const child of node.childNodes ?? []) attach(child, doc);
	return node;
}
