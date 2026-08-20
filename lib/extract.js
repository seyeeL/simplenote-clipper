// 网页正文与元信息提取。只在页面上下文里跑（需要真 DOM）。
//
// 两条路径：命中 lib/site-rules.js 里的站点规则就按规则取，否则走下面的通用启发式。
// 通用那条思路和 Readability 一致但砍到最小：先按语义选择器猜正文容器，猜不中就用
// 「段落文字量 × (1 - 链接密度)」给候选打分，最后克隆一份把噪声节点删掉。

import { ruleFor } from './site-rules.js';

// 整棵删掉的标签
const JUNK_TAGS = [
	'script', 'style', 'noscript', 'iframe', 'form', 'button', 'input',
	'select', 'textarea', 'svg', 'canvas', 'object', 'embed', 'template',
].join(',');

// 命中这些词的容器不可能是正文，文字再多也删
const ALWAYS_JUNK = /(^|[\s_-])(comments?|related|recommend|sidebar|advert|ads?|banner|newsletter|subscribe|signup|paywall|pagination|breadcrumb)([\s_-]|$)/i;

// 这些词只是弱证据 —— 正文容器也可能这么命名。微信公众号就把整篇正文放在
// <p class="share_notice_inner">里，按类名一刀切会把正文整块删掉。
const WEAK_JUNK = /(^|[\s_-])(share|sharing|social|promo|toolbar|nav|navbar|menu|header|footer|popup|modal|cookie|toc|catalog|copyright|disclaimer|author-box|backtotop)([\s_-]|$)/i;

// 弱证据下的保命线：文字量够多且不是链接堆，就当正文留着
const KEEP_TEXT_LEN = 200;
const MAX_LINK_DENSITY = 0.5;

// 常见正文容器，越靠前优先级越高。#js_content / .rich_media_content 是微信公众号
const PREFERRED = [
	'article',
	'[role="main"]',
	'main',
	'#js_content',
	'.rich_media_content',
	'.post-content',
	'.article-content',
	'.entry-content',
	'.markdown-body',
	'.post-body',
	'#content',
];

function all(node, selector) {
	if (!node || typeof node.querySelectorAll !== 'function') return [];
	return Array.from(node.querySelectorAll(selector));
}

function textLen(node) {
	return (node?.textContent ?? '').trim().length;
}

/** 段落文字量越大越像正文；链接文字占比越高越像导航/推荐列表。 */
function scoreNode(node) {
	if (!node) return 0;
	// 带 section：公众号、知乎这类站点大量用 <section> 排版，不算进去分数会是 0
	let paragraphs = 0;
	for (const el of all(node, 'p,li,blockquote,pre,section,figcaption,td,h2,h3,h4')) {
		paragraphs += textLen(el);
	}
	if (!paragraphs) return 0;
	let linkText = 0;
	for (const el of all(node, 'a')) linkText += textLen(el);
	const total = textLen(node) || 1;
	const density = Math.min(linkText / total, 0.95);
	return paragraphs * (1 - density);
}

function metaContent(doc, ...names) {
	for (const name of names) {
		const escaped = name.replace(/"/g, '\\"');
		const el = doc.querySelector(
			`meta[property="${escaped}"], meta[name="${escaped}"], meta[itemprop="${escaped}"]`,
		);
		const value = el?.getAttribute('content');
		if (value && value.trim()) return value.trim();
	}
	return '';
}

/** 站点的 JSON-LD 经常是非法 JSON 或嵌在 @graph 里，解析失败静默跳过即可。 */
function jsonLdNodes(doc) {
	const out = [];
	for (const script of all(doc, 'script[type="application/ld+json"]')) {
		let parsed;
		try {
			parsed = JSON.parse(script.textContent ?? '');
		} catch {
			continue;
		}
		const queue = Array.isArray(parsed) ? [...parsed] : [parsed];
		while (queue.length) {
			const item = queue.shift();
			if (!item || typeof item !== 'object') continue;
			out.push(item);
			if (Array.isArray(item['@graph'])) queue.push(...item['@graph']);
		}
	}
	return out;
}

function ldValue(doc, key) {
	for (const item of jsonLdNodes(doc)) {
		const value = item[key];
		if (typeof value === 'string' && value.trim()) return value.trim();
		if (Array.isArray(value) && value.length) {
			const first = value[0];
			if (typeof first === 'string' && first.trim()) return first.trim();
			if (first && typeof first.name === 'string') return first.name.trim();
		}
		if (value && typeof value === 'object' && typeof value.name === 'string') {
			return value.name.trim();
		}
	}
	return '';
}

/** document.title 常带「 - 站点名」后缀，元信息里已有站点名时把它切掉。 */
export function stripSiteSuffix(title, siteName) {
	const raw = String(title ?? '').trim();
	const site = String(siteName ?? '').trim();
	if (!raw || !site) return raw;
	const escaped = site.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	const stripped = raw.replace(new RegExp(`\\s*[|\\-–—_·]\\s*${escaped}\\s*$`, 'i'), '').trim();
	return stripped || raw;
}

function pickSiteName(doc, url) {
	const declared = metaContent(doc, 'og:site_name', 'application-name');
	if (declared) return declared;
	try {
		return new URL(url).hostname.replace(/^www\./, '');
	} catch {
		return '';
	}
}

/** 微博这类站点没有标题，取正文开头当标题。 */
function titleFromBody(root, limit = 40) {
	const text = (root?.textContent ?? '').replace(/\s+/g, ' ').trim();
	if (!text) return '';
	return text.length > limit ? `${text.slice(0, limit)}…` : text;
}

function pickTitle(doc, siteName, rule, root) {
	// 规则点名了标题在哪就用它。og:title 常带站点名后缀（小红书的是
	// 「标题 - 小红书」），拿页面上那个元素更干净
	if (rule?.title) {
		const el = doc.querySelector(rule.title);
		const text = (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
		if (text) return text;
	}
	if (rule?.titleFromBody) {
		const fromBody = titleFromBody(root);
		if (fromBody) return fromBody;
	}
	const declared = metaContent(doc, 'og:title', 'twitter:title');
	if (declared) return declared;
	const ld = ldValue(doc, 'headline');
	if (ld) return ld;
	const h1 = doc.querySelector('h1');
	if (h1 && textLen(h1)) return h1.textContent.trim();
	return stripSiteSuffix(doc.title ?? '', siteName);
}

function pickAuthor(doc, rule) {
	if (rule?.author) {
		const el = doc.querySelector(rule.author);
		const text = (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
		if (text) return text;
	}
	const declared = metaContent(doc, 'author', 'article:author', 'twitter:creator', 'byl');
	// article:author 有时是个 URL，不是人名
	if (declared && !/^https?:\/\//i.test(declared)) return declared;
	const ld = ldValue(doc, 'author');
	if (ld) return ld;
	for (const selector of ['[rel="author"]', '[itemprop="author"]', '.author', '.byline', '#js_name']) {
		const el = doc.querySelector(selector);
		const text = (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
		if (text && text.length <= 60) return text;
	}
	return declared || '';
}

function pickPublished(doc, rule, url = '') {
	// 页面上只有相对时间、真实时间藏在别处时用（小红书）。取不到就往下走。
	if (rule?.publishedFrom) {
		const value = rule.publishedFrom(doc, url);
		if (value) return value;
	}
	if (rule?.published) {
		const el = doc.querySelector(rule.published);
		const raw = (el?.getAttribute?.('title') || el?.textContent || '').trim();
		if (raw) return rule.normalizePublished ? rule.normalizePublished(raw) : raw;
	}
	const declared = metaContent(
		doc, 'article:published_time', 'og:article:published_time',
		'datePublished', 'publishdate', 'pubdate',
	);
	if (declared) return declared;
	const ld = ldValue(doc, 'datePublished');
	if (ld) return ld;
	const time = doc.querySelector('time[datetime]');
	const dt = time?.getAttribute('datetime');
	return dt && dt.trim() ? dt.trim() : '';
}

/**
 * 同一个元素被多个选择器命中要去重；一个匹配落在另一个匹配里面时只留最外层。
 * 微博的兜底选择器 `[class*="wbtext"]` 就套在 `.wbpro-feed-content` 里，两块都收
 * 会把正文重复一遍。
 */
export function dropNested(elements) {
	const unique = [];
	for (const el of elements) if (!unique.includes(el)) unique.push(el);
	return unique.filter((el) => !unique.some((other) => other !== el && other.contains?.(el)));
}

/**
 * 站点规则指定的正文容器。规则写了就是明确断言「正文在这」，不再打分。
 * root 可以是一组选择器：命中的块按顺序拼成一个容器交给下游。
 */
function pickRuleRoot(doc, rule) {
	if (!rule?.root) return null;
	const selectors = Array.isArray(rule.root) ? rule.root : [rule.root];
	const matched = [];
	for (const selector of selectors) {
		for (const el of all(doc, selector)) {
			if (textLen(el) || all(el, 'img').length) matched.push(el);
		}
	}
	const roots = dropNested(matched);
	if (!roots.length) return null;
	if (roots.length === 1) return roots[0];

	const wrapper = doc.createElement('div');
	for (const el of roots) wrapper.appendChild(el.cloneNode(true));
	return wrapper;
}

/** 找正文容器：先试语义选择器，不达标就从每个 <p> 往上三层收候选来打分。 */
export function pickRoot(doc) {
	for (const selector of PREFERRED) {
		const el = doc.querySelector(selector);
		if (el && scoreNode(el) >= 200) return el;
	}

	const candidates = new Set();
	for (const p of all(doc, 'p')) {
		let el = p.parentElement;
		let depth = 0;
		while (el && depth < 3 && el !== doc.body) {
			candidates.add(el);
			el = el.parentElement;
			depth += 1;
		}
	}

	let best = null;
	let bestScore = 0;
	for (const el of candidates) {
		const score = scoreNode(el);
		if (score > bestScore) {
			bestScore = score;
			best = el;
		}
	}
	if (best && bestScore >= 100) return best;

	// 全都不达标（短页面、列表页）：宁可要个不完美的容器，也别整页 body
	for (const selector of PREFERRED) {
		const el = doc.querySelector(selector);
		if (el) return el;
	}
	return doc.body ?? null;
}

/**
 * 按 class / id 判断一个容器是不是噪声。
 * getLinkTextLength 是懒调用的：只有走到链接密度这一步才扫，否则整页每个节点
 * 都做一次子树遍历，长文章会卡。
 */
export function shouldDropByClass({
	className = '',
	id = '',
	textLength = 0,
	getLinkTextLength = () => 0,
} = {}) {
	const key = `${className} ${id}`;
	if (ALWAYS_JUNK.test(key)) return true;
	if (!WEAK_JUNK.test(key)) return false;
	if (textLength < KEEP_TEXT_LEN) return true;
	return getLinkTextLength() / textLength >= MAX_LINK_DENSITY;
}

/** 一棵子树里的所有文本节点。clone 是脱离文档的，递归比 TreeWalker 省事。 */
export function textNodesIn(node, out = []) {
	for (const child of Array.from(node?.childNodes ?? [])) {
		if (child.nodeType === 3) out.push(child);
		else if (child.nodeType === 1) textNodesIn(child, out);
	}
	return out;
}

/** 选择器命中的元素，包含容器自身（root 本身就是那个容器时 querySelectorAll 找不到它）。 */
function selfAndAll(node, selector) {
	const found = all(node, selector);
	return node?.matches?.(selector) ? [node, ...found] : found;
}

/**
 * 把文本节点里的 \n 换成 <br>。小红书这类站点的正文靠 CSS white-space 把 
 显示成
 * 换行，HTML 里并没有 <br> 或 <p>；照通用规则把换行当普通空白压掉的话，整篇文案会
 * 挤成一行。只在规则点名的容器里做，别的站点 HTML 里的换行确实只是排版空白。
 */
export function keepLineBreaks(clone, selectors = []) {
	const doc = clone.ownerDocument;
	if (!doc) return;
	for (const selector of selectors) {
		for (const el of selfAndAll(clone, selector)) {
			for (const node of textNodesIn(el)) {
				const text = node.textContent ?? '';
				if (!text.includes('\n')) continue;
				const frag = doc.createDocumentFragment();
				text.split('\n').forEach((part, index) => {
					if (index) frag.appendChild(doc.createElement('br'));
					if (part) frag.appendChild(doc.createTextNode(part));
				});
				node.replaceWith(frag);
			}
		}
	}
}

/**
 * 抹掉规则点名的文本片段。小红书的话题标签里夹着 [eoi] 这种图标占位，页面上渲染成
 * 一个小图标，取 textContent 就露出来了；它和正文 span 长得一模一样，选择器区分不了。
 */
export function stripText(clone, patterns = []) {
	if (!patterns.length) return;
	for (const node of textNodesIn(clone)) {
		const before = node.textContent ?? '';
		if (!before) continue;
		let after = before;
		for (const pattern of patterns) after = after.replace(pattern, '');
		if (after !== before) node.textContent = after;
	}
}

/** 在克隆体上删噪声，绝不改用户正在看的页面。 */
function cleanClone(root, rule) {
	const clone = root.cloneNode(true);

	for (const el of all(clone, JUNK_TAGS)) el.remove();
	// 站点规则里点名要删的（微博的表情图片之类）
	for (const selector of rule?.drop ?? []) {
		for (const el of all(clone, selector)) el.remove();
	}
	for (const el of all(clone, '[hidden],[aria-hidden="true"]')) el.remove();
	// 规则点名要「脱掉」的元素：文字留下，标签本身丢掉。小红书的话题标签是
	// <a href="/search_result?...">#刘亦菲</a>，直接转 markdown 会在正文里塞一串
	// 指向站内搜索的相对链接，笔记里点不开也不好看
	for (const selector of rule?.unwrap ?? []) {
		for (const el of all(clone, selector)) {
			el.replaceWith(clone.ownerDocument.createTextNode(el.textContent ?? ''));
		}
	}

	// 都放在 unwrap 之后：脱掉标签会并出新的文本节点，占位符和换行都藏在里面
	stripText(clone, rule?.stripText ?? []);
	keepLineBreaks(clone, rule?.keepLineBreaks ?? []);

	for (const el of all(clone, '[class],[id]')) {
		const drop = shouldDropByClass({
			className: el.getAttribute('class') ?? '',
			id: el.getAttribute('id') ?? '',
			textLength: textLen(el),
			getLinkTextLength: () => all(el, 'a').reduce((sum, a) => sum + textLen(a), 0),
		});
		if (drop) el.remove();
	}

	// 站点规则里的图片地址改写（微博缩略图换原图）。放在删噪声之后，
	// 已经删掉的节点不用白改一遍。
	if (rule?.rewriteImageSrc) {
		for (const img of all(clone, 'img')) {
			const src = img.getAttribute('src') ?? '';
			const next = rule.rewriteImageSrc(src);
			if (next && next !== src) img.setAttribute('src', next);
		}
	}

	return clone;
}

/**
 * @returns {{url, title, author, publishedAt, siteName, root}} root 是已清洗的克隆节点
 */
export function extractArticle(doc, url = '') {
	const href = url || doc?.location?.href || '';
	const rule = ruleFor(href);
	const siteName = pickSiteName(doc, href);
	// 标题可能要从正文取（微博和小红书都没有独立标题），所以 root 先算。
	// 取的是洗过的那份：不然小红书九宫格的「1/4」页码会跑到标题里
	const root = pickRuleRoot(doc, rule) ?? pickRoot(doc);
	const cleaned = root ? cleanClone(root, rule) : null;
	return {
		url: href,
		siteName,
		title: pickTitle(doc, siteName, rule, cleaned),
		author: pickAuthor(doc, rule),
		publishedAt: pickPublished(doc, rule, href),
		root: cleaned,
	};
}
