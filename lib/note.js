// 纯函数层：不碰 DOM、不发网络请求，node --test 可直接 import。
// Simplenote 笔记正文的第一行会被当成标题显示，所以 buildNoteContent 的第一行只放标题。

const MAX_TAG_LEN = 64;

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

/** ISO 串 / Date / 时间戳 → YYYY-MM-DD（本地时区）。解析不出来就原样返回。 */
export function toDateString(value) {
	if (value === null || value === undefined || value === '') return '';
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
 * 结构：标题行 / 空行 / 来源 URL / 元信息 / --- / 正文 markdown
 */
export function buildNoteContent({
	title,
	url = '',
	author = '',
	publishedAt = '',
	siteName = '',
	markdown = '',
	clippedAt = null,
} = {}) {
	const heading = singleLine(title) || singleLine(siteName) || url || '未命名剪藏';

	const meta = [];
	const site = singleLine(siteName);
	if (site) meta.push(site);
	const who = singleLine(author);
	if (who) meta.push(`作者 ${who}`);
	const published = toDateString(publishedAt);
	if (published) meta.push(`发布 ${published}`);
	const clipped = toDateString(clippedAt ?? new Date());
	if (clipped) meta.push(`剪藏 ${clipped}`);

	const lines = [heading, ''];
	if (url) lines.push(`来源：${url}`);
	if (meta.length) lines.push(meta.join(' · '));
	lines.push('', '---', '');

	const body = String(markdown ?? '')
		.replace(/\r\n/g, '\n')
		.replace(/[ \t]+$/gm, '')
		.replace(/\n{3,}/g, '\n\n')
		.trim();
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
