// 纯函数层：不碰 DOM、不发网络请求，node --test 可直接 import。
// Simplenote 笔记正文的第一行会被当成标题显示，所以 buildNoteContent 的第一行只放纯标题。

import { domainTag } from './domains.js';

const MAX_TAG_LEN = 64;
// 超过这个长度的「作者」多半是把整段简介抓进来了，宁可不打标签
const MAX_AUTHOR_TAG_LEN = 40;

/**
 * Simplenote 标签不能含空格和逗号（客户端按这两者切分），这里统一切分 + 去重。
 * 接受字符串或数组，两种输入都会再按分隔符拆一遍。
 */
export function normalizeTags(input) {
	const raw = Array.isArray(input) ? input : String(input ?? '').split(/[,，\s]+/);
	const out = [];
	for (const item of raw) {
		for (const piece of String(item ?? '').split(/[,，\s]+/)) {
			const tag = piece.trim().slice(0, MAX_TAG_LEN);
			if (!tag) continue;
			if (!out.some((t) => t.toLowerCase() === tag.toLowerCase())) out.push(tag);
		}
	}
	return out;
}

/** 作者名整体当一个标签：内部空格换成连字符，否则会被 normalizeTags 拆成好几个。 */
export function authorTag(author) {
	const name = String(author ?? '')
		.trim()
		.replace(/[,，\s]+/g, '-')
		.replace(/^-+|-+$/g, '');
	if (!name || name.length > MAX_AUTHOR_TAG_LEN) return '';
	return name;
}

/** 用户手填标签 + 作者标签 + 来源站点标签，合成最终标签数组。 */
export function buildTags({ tags = [], author = '', url = '' } = {}) {
	return normalizeTags([...normalizeTags(tags), authorTag(author), domainTag(url)]);
}

// 2026年8月19日 / 2026-8-19 / 2026/08/19 —— 公众号的 #publish_time 是中文格式，
// new Date() 直接吃不下
const DATE_PARTS = /(\d{4})\s*[年\-/.]\s*(\d{1,2})\s*[月\-/.]\s*(\d{1,2})/;

/** ISO 串 / Date / 时间戳 / 中文日期 → YYYY-MM-DD（本地时区）。解析不出来就原样返回。 */
export function toDateString(value) {
	if (value === null || value === undefined || value === '') return '';

	if (typeof value === 'string') {
		const parts = value.match(DATE_PARTS);
		if (parts) {
			const [, y, m, day] = parts;
			return `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
		}
	}

	const d = value instanceof Date ? value : new Date(value);
	if (Number.isNaN(d.getTime())) return typeof value === 'string' ? value.trim() : '';
	const pad = (n) => String(n).padStart(2, '0');
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** 标题里的换行会把 Simplenote 的标题行截断，先压成单行。 */
function singleLine(value) {
	return String(value ?? '').replace(/\s+/g, ' ').trim();
}

/**
 * 正文开头的标题和笔记标题往往是同一句（大部分文章页 <h1> 就是标题），
 * 留着就成了重复两行。只在完全一致时去掉，不一致说明是正文自己的小节标题。
 */
export function stripDuplicateHeading(markdown, title) {
	const body = String(markdown ?? '');
	const key = singleLine(title);
	if (!key) return body;
	const match = body.match(/^\s*(#{1,3})\s+(.+?)\s*(?:\n|$)/);
	if (!match || singleLine(match[2]) !== key) return body;
	return body.slice(match[0].length).replace(/^\n+/, '');
}

/**
 * 拼出最终写进 Simplenote 的正文。结构：
 *
 *   标题
 *   ---
 *   (空行)
 *   url: … ␠
 *   author: … ␠
 *   published: … ␠
 *   created: … ␠
 *   (空行)
 *   正文 markdown
 *
 * 标题下面那行 --- 是 markdown 的 setext 一级标题写法：预览里是 H1，
 * 而第一行仍然是纯标题，Simplenote 的笔记列表显示的就是它。
 * 属性行末尾各留一个空格，否则 Simplenote 预览会把连续几行并成一段。
 * 站点不进属性区，只以标签形式存在（见 buildTags）。
 */
export function buildNoteContent({
	title,
	url = '',
	author = '',
	publishedAt = '',
	siteName = '',
	markdown = '',
	clippedAt = null,
	titleHeading = false,
} = {}) {
	const heading = singleLine(title) || singleLine(siteName) || url || '未命名剪藏';

	const front = [];
	if (url) front.push(`url: ${url}`);
	// 作者同时进标签（见 buildTags）和属性区：标签能筛，属性区能直接读到原样的名字
	const who = singleLine(author);
	if (who) front.push(`author: ${who}`);
	const published = toDateString(publishedAt);
	if (published) front.push(`published: ${published}`);
	const created = toDateString(clippedAt ?? new Date());
	if (created) front.push(`created: ${created}`);

	const body = stripDuplicateHeading(markdown, heading)
		.replace(/\r\n/g, '\n')
		.replace(/[ \t]+$/gm, '')
		.replace(/\n{3,}/g, '\n\n')
		.trim();

	// titleHeading 开着时用 ATX 的 "# 标题"，就不再补 setext 的 ---，
	// 否则一个标题会同时套两种写法，--- 会退化成一条分隔线
	const lines = titleHeading ? [`# ${heading}`, ''] : [heading, '---', ''];
	// 每行末尾一个空格：Simplenote 预览会把连续行并成一段，加空格才逐行断开
	if (front.length) lines.push(...front.map((line) => `${line} `), '');
	lines.push(body || '（未提取到正文，只存了链接）');
	return lines.join('\n');
}

/** 组装 Simperium note bucket 的 payload。字段名和官方客户端一致，缺字段会被别的端当成空值覆盖。 */
export function buildNoteData({
	content,
	tags = [],
	markdown = true,
	pinned = false,
	now = Date.now(),
} = {}) {
	const unix = Math.floor(now / 1000);
	const systemTags = [];
	if (markdown) systemTags.push('markdown');
	if (pinned) systemTags.push('pinned');
	return {
		content: String(content ?? ''),
		creationDate: unix,
		modificationDate: unix,
		deleted: false,
		publishURL: '',
		shareURL: '',
		systemTags,
		tags: normalizeTags(tags),
	};
}
