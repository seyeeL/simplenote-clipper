// Markdown 里图片链接的收集与替换。纯字符串操作，可 node 测。

// html2md 只产出 ![alt](src) 这一种形式，不带 title
const IMAGE_PATTERN = /!\[([^\]]*)\]\(([^)\s]+)\)/g;

// 图片外面套一层链接：[![alt](img)](href)。很多站点的插图都是可点开大图的，
// 只删裸图会剩下 [](href) 这种指向不明的空链接
const LINKED_IMAGE_PATTERN = /\[!\[[^\]]*\]\([^)\s]+\)\]\([^)\s]+\)/g;

const EXT_BY_TYPE = {
	'image/jpeg': 'jpg',
	'image/jpg': 'jpg',
	'image/png': 'png',
	'image/gif': 'gif',
	'image/webp': 'webp',
	'image/avif': 'avif',
	'image/svg+xml': 'svg',
	'image/bmp': 'bmp',
	'image/x-icon': 'ico',
	'image/heic': 'heic',
};

const KNOWN_EXTS = new Set(Object.values(EXT_BY_TYPE));

/** 正文里所有 http(s) 图片地址，按出现顺序去重。 */
export function collectImageUrls(markdown) {
	const seen = [];
	for (const [, , url] of String(markdown ?? '').matchAll(IMAGE_PATTERN)) {
		if (!/^https?:\/\//i.test(url)) continue;
		if (!seen.includes(url)) seen.push(url);
	}
	return seen;
}

/**
 * 按映射换掉图片地址。只动图片语法里的 URL，正文里同样的裸链接不动
 * （文章末尾常有原文链接，换成图床地址就错了）。
 */
export function rewriteImageUrls(markdown, mapping = {}) {
	return String(markdown ?? '').replace(IMAGE_PATTERN, (match, alt, url) => {
		const next = mapping[url];
		return next ? `![${alt}](${next})` : match;
	});
}

/**
 * 把正文里的图片整个删掉，返回删了几张。给「不保存图片」用。
 * 图片常常独占一段，删完会留下一串空行，顺手压掉。
 */
export function stripImages(markdown) {
	let removed = 0;
	const count = () => {
		removed += 1;
		return '';
	};
	const out = String(markdown ?? '')
		.replace(LINKED_IMAGE_PATTERN, count)
		.replace(IMAGE_PATTERN, count)
		.replace(/[ \t]+$/gm, '')
		.replace(/\n{3,}/g, '\n\n')
		.trim();
	return { markdown: out, removed };
}

/** 优先信 Content-Type，其次看 URL 后缀，都认不出按 jpg 处理。 */
export function extensionFor(contentType, url = '') {
	const type = String(contentType ?? '').split(';')[0].trim().toLowerCase();
	if (EXT_BY_TYPE[type]) return EXT_BY_TYPE[type];

	let pathname = '';
	try {
		pathname = new URL(url).pathname;
	} catch {
		pathname = String(url);
	}
	const fromPath = pathname.split('.').pop()?.toLowerCase() ?? '';
	if (KNOWN_EXTS.has(fromPath)) return fromPath;
	if (fromPath === 'jpeg') return 'jpg';

	// 微信把真实格式放在 query 里，路径本身没有后缀
	const fromQuery = String(url).match(/[?&]wx_fmt=([a-z0-9]+)/i);
	if (fromQuery && KNOWN_EXTS.has(fromQuery[1].toLowerCase())) return fromQuery[1].toLowerCase();

	return 'jpg';
}

/** 字节数组的 SHA-256，十六进制。用作图床对象名，天然去重。 */
export async function sha256Hex(buffer) {
	const digest = await crypto.subtle.digest('SHA-256', buffer);
	return Array.from(new Uint8Array(digest))
		.map((b) => b.toString(16).padStart(2, '0'))
		.join('');
}

/**
 * 图片站点要 Referer 才给图时（微博的 sinaimg）用的 declarativeNetRequest 会话规则。
 * fetch 改不了 Referer —— 它是禁止头，赋值会被静默丢掉 —— 只能让浏览器在发出去的
 * 路上改。
 *
 * tabIds: [-1] 把规则限死在 service worker 自己发的请求上：用户正在看的页面归
 * tab 管，tabId 不是 -1，不会被这条规则动到。
 */
export function buildRefererRules(rule, startId = 1) {
	const referer = rule?.imageReferer;
	const hosts = rule?.imageHosts ?? [];
	if (!referer || !hosts.length) return [];
	return hosts.map((host, index) => ({
		id: startId + index,
		priority: 1,
		action: {
			type: 'modifyHeaders',
			requestHeaders: [{ header: 'Referer', operation: 'set', value: referer }],
		},
		condition: {
			urlFilter: `||${host}^`,
			// service worker 里的 fetch 报成哪种 resourceType 没有白纸黑字的保证，
			// 三种都列上；漏了的话规则静默不生效，比多列一种难查得多
			resourceTypes: ['xmlhttprequest', 'other', 'image'],
			// -1 = 不属于任何标签页的请求，也就是 service worker 自己发的
			tabIds: [-1],
		},
	}));
}
