// Markdown 里图片链接的收集与替换。纯字符串操作，可 node 测。

// html2md 只产出 ![alt](src) 这一种形式，不带 title
const IMAGE_PATTERN = /!\[([^\]]*)\]\(([^)\s]+)\)/g;

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
