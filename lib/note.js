// 纯函数层：不碰 DOM、不发网络请求，node --test 可直接 import。
// Simplenote 笔记正文的第一行会被当成标题显示，所以 buildNoteContent 的第一行只放标题，
// frontmatter 排在标题之后 —— 顶格写 --- 会让所有笔记在列表里都叫「---」。

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
 * 拼出最终写进 Simplenote 的正文。
 * 结构：标题行 / 空行 / --- frontmatter --- / 空行 / 正文 markdown
 * 作者和站点不进 frontmatter，它们以标签形式存在（见 buildTags）。
 */
export function buildNoteContent({
	title,
	url = '',
	publishedAt = '',
	siteName = '',
	markdown = '',
	clippedAt = null,
} = {}) {
	const heading = singleLine(title) || singleLine(siteName) || url || '未命名剪藏';

	const front = [];
	if (url) front.push(`url: ${url}`);
	const published = toDateString(publishedAt);
	if (published) front.push(`published: ${published}`);
	const created = toDateString(clippedAt ?? new Date());
	if (created) front.push(`created: ${created}`);

	const body = String(markdown ?? '')
		.replace(/\r\n/g, '\n')
		.replace(/[ \t]+$/gm, '')
		.replace(/\n{3,}/g, '\n\n')
		.trim();

	const lines = [heading, ''];
	if (front.length) lines.push('---', ...front, '---', '');
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
