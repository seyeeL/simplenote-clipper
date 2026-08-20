// 网页正文与元信息提取。只在页面上下文里跑（需要真 DOM）。
// 思路和 Readability 一致但砍到最小：先按语义选择器猜正文容器，猜不中就用
// 「段落文字量 × (1 - 链接密度)」给候选打分，最后克隆一份把噪声节点删掉。

// 整棵删掉的标签
const JUNK_TAGS = [
	'script', 'style', 'noscript', 'iframe', 'form', 'button', 'input',
	'select', 'textarea', 'svg', 'canvas', 'object', 'embed', 'template',
].join(',');

// class / id 命中这些词的容器基本是导航、分享、推荐、广告
const JUNK_PATTERN = /(^|[\s_-])(comments?|share|sharing|social|related|recommend|sidebar|promo|advert|ads?|banner|breadcrumb|newsletter|subscribe|signup|paywall|toolbar|pagination|author-box|footer|nav|navbar|menu|popup|modal|cookie|toc|catalog|copyright|disclaimer|backtotop)([\s_-]|$)/i;

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
	let paragraphs = 0;
	for (const el of all(node, 'p,li,blockquote,pre,h2,h3')) paragraphs += textLen(el);
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

function pickTitle(doc, siteName) {
	const declared = metaContent(doc, 'og:title', 'twitter:title');
	if (declared) return declared;
	const ld = ldValue(doc, 'headline');
	if (ld) return ld;
	const h1 = doc.querySelector('h1');
	if (h1 && textLen(h1)) return h1.textContent.trim();
	return stripSiteSuffix(doc.title ?? '', siteName);
}

function pickAuthor(doc) {
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

function pickPublished(doc) {
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

/** 在克隆体上删噪声，绝不改用户正在看的页面。 */
function cleanClone(root) {
	const clone = root.cloneNode(true);

	for (const el of all(clone, JUNK_TAGS)) el.remove();
	for (const el of all(clone, '[hidden],[aria-hidden="true"]')) el.remove();

	for (const el of all(clone, '[class],[id]')) {
		const key = `${el.getAttribute('class') ?? ''} ${el.getAttribute('id') ?? ''}`;
		// 命中噪声词但内部还有段落/代码块的，多半是误伤，留着
		if (JUNK_PATTERN.test(key) && !el.querySelector('p,pre')) el.remove();
	}

	return clone;
}

/**
 * @returns {{url, title, author, publishedAt, siteName, root}} root 是已清洗的克隆节点
 */
export function extractArticle(doc, url = '') {
	const href = url || doc?.location?.href || '';
	const siteName = pickSiteName(doc, href);
	const root = pickRoot(doc);
	return {
		url: href,
		siteName,
		title: pickTitle(doc, siteName),
		author: pickAuthor(doc),
		publishedAt: pickPublished(doc),
		root: root ? cleanClone(root) : null,
	};
}
