// HTML → Markdown。只用 nodeType / nodeName / childNodes / getAttribute / textContent
// 这五个接口走树，不碰 querySelectorAll，所以 node 测试里用手搓假节点就能覆盖。

const ELEMENT_NODE = 1;
const TEXT_NODE = 3;

const HEADINGS = { H1: 1, H2: 2, H3: 3, H4: 4, H5: 5, H6: 6 };
// 走到就整棵丢掉
const DROP = new Set([
	'SCRIPT', 'STYLE', 'NOSCRIPT', 'IFRAME', 'FORM', 'BUTTON', 'INPUT',
	'SELECT', 'TEXTAREA', 'SVG', 'CANVAS', 'VIDEO', 'AUDIO', 'OBJECT',
	'EMBED', 'TEMPLATE', 'LINK', 'META', 'HEAD',
]);

function childrenOf(node) {
	return Array.from(node?.childNodes ?? []);
}

function attr(node, name) {
	if (!node || typeof node.getAttribute !== 'function') return '';
	return node.getAttribute(name) ?? '';
}

/** 图片站点普遍懒加载，src 常是占位图，真地址在 data-src 系列属性里。 */
function pickImageSrc(node) {
	const candidates = [
		attr(node, 'src'),
		attr(node, 'data-src'),
		attr(node, 'data-original'),
		attr(node, 'data-actualsrc'),
		attr(node, 'data-lazy-src'),
	];
	for (const value of candidates) {
		const src = String(value).trim();
		if (src && !src.startsWith('data:')) return src;
	}
	return '';
}

/** 语言标记通常挂在 code/pre 的 class 上（language-js / lang-python / hljs js）。 */
function pickCodeLang(node) {
	const raw = `${attr(node, 'class')} ${attr(node, 'data-lang')}`;
	const match = raw.match(/(?:language|lang)[-:]([\w+#-]+)/i);
	return match ? match[1] : '';
}

function isBlank(value) {
	return !value || !value.trim();
}

function renderChildren(node, ctx) {
	let out = '';
	for (const child of childrenOf(node)) out += render(child, ctx);
	return out;
}

/** 行内场景要把块级产物压成单行（表格单元格、标题里嵌了 p 之类）。 */
function inline(node, ctx) {
	return renderChildren(node, ctx).replace(/\s*\n+\s*/g, ' ').trim();
}

function block(text) {
	return isBlank(text) ? '' : `\n\n${text.trim()}\n\n`;
}

/** 只按 childNodes 递归找某类标签；stopAt 里的标签自成一体，不往里钻。 */
function collect(node, nodeName, stopAt = new Set()) {
	const found = [];
	for (const child of childrenOf(node)) {
		if (child.nodeType !== ELEMENT_NODE) continue;
		if (child.nodeName === nodeName) {
			found.push(child);
			continue;
		}
		if (stopAt.has(child.nodeName)) continue;
		found.push(...collect(child, nodeName, stopAt));
	}
	return found;
}

function renderList(node, ctx) {
	const ordered = node.nodeName === 'OL';
	const startAttr = parseInt(attr(node, 'start'), 10);
	let index = Number.isFinite(startAttr) && startAttr > 0 ? startAttr : 1;
	const depth = ctx.listDepth ?? 0;
	const childCtx = { ...ctx, listDepth: depth + 1 };

	const items = [];
	for (const item of collect(node, 'LI', new Set(['UL', 'OL']))) {
		const marker = ordered ? `${index}. ` : '- ';
		index += 1;
		// 缩进全靠这里：续行按 marker 宽度对齐，嵌套列表因此逐层右移
		const body = renderChildren(item, childCtx)
			.replace(/^\n+/, '')
			.replace(/\n{3,}/g, '\n\n')
			.trimEnd();
		if (isBlank(body)) continue;
		const [first, ...rest] = body.split('\n');
		const pad = ' '.repeat(marker.length);
		const tail = rest.map((line) => (isBlank(line) ? '' : pad + line));
		items.push(marker + first.trim() + (tail.length ? `\n${tail.join('\n')}` : ''));
	}
	if (!items.length) return '';
	// 顶层列表前后留空行；嵌套列表只换一行，否则 markdown 会断成两个列表
	return depth === 0 ? `\n\n${items.join('\n')}\n\n` : `\n${items.join('\n')}`;
}

function renderTable(node, ctx) {
	const rows = collect(node, 'TR', new Set(['TABLE']));
	if (!rows.length) return block(renderChildren(node, ctx));

	const grid = rows
		.map((row) =>
			childrenOf(row)
				.filter((c) => c.nodeType === ELEMENT_NODE && (c.nodeName === 'TD' || c.nodeName === 'TH'))
				.map((cell) => inline(cell, ctx).replace(/\|/g, '\\|') || ' '),
		)
		.filter((cells) => cells.length);

	if (!grid.length) return '';
	const width = Math.max(...grid.map((cells) => cells.length));
	const pad = (cells) => [...cells, ...Array(width - cells.length).fill(' ')];

	const [head, ...body] = grid;
	const lines = [
		`| ${pad(head).join(' | ')} |`,
		`| ${Array(width).fill('---').join(' | ')} |`,
		...body.map((cells) => `| ${pad(cells).join(' | ')} |`),
	];
	return `\n\n${lines.join('\n')}\n\n`;
}

function render(node, ctx) {
	if (!node) return '';

	if (node.nodeType === TEXT_NODE) {
		return (node.textContent ?? '').replace(/\s+/g, ' ');
	}
	if (node.nodeType !== ELEMENT_NODE) return '';

	const name = node.nodeName;
	if (DROP.has(name)) return '';

	if (HEADINGS[name]) {
		const text = inline(node, ctx);
		return isBlank(text) ? '' : `\n\n${'#'.repeat(HEADINGS[name])} ${text}\n\n`;
	}

	switch (name) {
		case 'P':
			return block(renderChildren(node, ctx));
		case 'BR':
			return '  \n';
		case 'HR':
			return '\n\n---\n\n';
		case 'STRONG':
		case 'B': {
			const text = inline(node, ctx);
			return text ? `**${text}**` : '';
		}
		case 'EM':
		case 'I': {
			const text = inline(node, ctx);
			return text ? `*${text}*` : '';
		}
		case 'DEL':
		case 'S':
		case 'STRIKE': {
			const text = inline(node, ctx);
			return text ? `~~${text}~~` : '';
		}
		case 'CODE': {
			const text = (node.textContent ?? '').replace(/\s+/g, ' ').trim();
			if (!text) return '';
			// 内容自带反引号时改用双反引号包，避免提前闭合
			return text.includes('`') ? `\`\` ${text} \`\`` : `\`${text}\``;
		}
		case 'PRE': {
			const text = (node.textContent ?? '').replace(/\r\n/g, '\n').replace(/\n+$/, '');
			if (isBlank(text)) return '';
			const lang = pickCodeLang(node) || pickCodeLang(collect(node, 'CODE')[0]);
			return `\n\n\`\`\`${lang}\n${text}\n\`\`\`\n\n`;
		}
		case 'A': {
			const href = String(attr(node, 'href')).trim();
			const text = inline(node, ctx);
			if (!text) return '';
			// 锚点和 javascript: 没有归档价值，退成纯文本
			if (!href || href.startsWith('#') || href.startsWith('javascript:')) return text;
			return `[${text}](${href})`;
		}
		case 'IMG': {
			const src = pickImageSrc(node);
			if (!src) return '';
			const alt = String(attr(node, 'alt')).replace(/\s+/g, ' ').trim();
			return `![${alt}](${src})`;
		}
		case 'UL':
		case 'OL':
			return renderList(node, ctx);
		case 'LI':
			// 脱离列表单独出现的 li，按普通块处理
			return block(renderChildren(node, ctx));
		case 'BLOCKQUOTE': {
			// 块级元素两边各加一对换行，两个 p 之间会攒出多余空行；加了 > 之后
			// 这些行不再为空，收口的 normalizeMarkdown 压不掉，必须在这里先压。
			const inner = renderChildren(node, ctx).replace(/\n{3,}/g, '\n\n').trim();
			if (!inner) return '';
			const quoted = inner
				.split('\n')
				.map((line) => (isBlank(line) ? '>' : `> ${line}`))
				.join('\n');
			return `\n\n${quoted}\n\n`;
		}
		case 'TABLE':
			return renderTable(node, ctx);
		case 'FIGCAPTION': {
			const text = inline(node, ctx);
			return text ? `\n\n*${text}*\n\n` : '';
		}
		default:
			// div / span / figure / dl 等纯容器，透传子节点
			return renderChildren(node, ctx);
	}
}

/** 收口：去行尾空格（保留 markdown 硬换行的两个）、压连续空行、去首尾空白。 */
export function normalizeMarkdown(text) {
	return String(text ?? '')
		.replace(/\r\n/g, '\n')
		.replace(/[^\S\n]+$/gm, (match) => (match.length >= 2 ? '  ' : ''))
		.replace(/\n{3,}/g, '\n\n')
		.trim();
}

export function htmlToMarkdown(node) {
	if (!node) return '';
	return normalizeMarkdown(render(node, { listDepth: 0 }));
}
