import test from 'node:test';
import assert from 'node:assert/strict';

import { buildNoteContent, buildNoteData, normalizeTags, toDateString } from '../lib/note.js';

test('标签按空格 / 半角逗号 / 全角逗号切分并去重（忽略大小写）', () => {
	assert.deepEqual(normalizeTags('clip 技术，读书,Clip'), ['clip', '技术', '读书']);
	assert.deepEqual(normalizeTags(['a b', 'c']), ['a', 'b', 'c']);
	assert.deepEqual(normalizeTags(''), []);
	assert.deepEqual(normalizeTags(null), []);
});

test('标签超长截断到 64 字符', () => {
	assert.equal(normalizeTags('x'.repeat(100))[0].length, 64);
});

test('toDateString 吃 ISO / Date / 时间戳，解析不出来就原样返回', () => {
	assert.equal(toDateString('2026-08-20T12:00:00Z'), toDateString(new Date('2026-08-20T12:00:00Z')));
	assert.equal(toDateString(new Date(2026, 7, 20)), '2026-08-20');
	assert.equal(toDateString('民国八十年'), '民国八十年');
	assert.equal(toDateString(''), '');
	assert.equal(toDateString(null), '');
});

test('第一行只放标题 —— Simplenote 按第一行显示笔记名', () => {
	const content = buildNoteContent({
		title: '标题\n带换行',
		url: 'https://example.com/a',
		markdown: '正文',
		clippedAt: new Date(2026, 7, 20),
	});
	assert.equal(content.split('\n')[0], '标题 带换行');
});

test('元信息行按站点 · 作者 · 发布 · 剪藏 排列，缺项自动省略', () => {
	const content = buildNoteContent({
		title: 'T',
		url: 'https://example.com/a',
		siteName: '某站',
		publishedAt: '2026-01-02T00:00:00Z',
		markdown: '正文',
		clippedAt: new Date(2026, 7, 20),
	});
	const lines = content.split('\n');
	assert.equal(lines[2], '来源：https://example.com/a');
	assert.equal(lines[3], `某站 · 发布 ${toDateString('2026-01-02T00:00:00Z')} · 剪藏 2026-08-20`);
	assert.ok(!lines[3].includes('作者'));
});

test('标题为空时退到站点名，再退到 URL', () => {
	const clippedAt = new Date(2026, 7, 20);
	assert.equal(buildNoteContent({ siteName: '某站', url: 'https://a.b', clippedAt }).split('\n')[0], '某站');
	assert.equal(buildNoteContent({ url: 'https://a.b', clippedAt }).split('\n')[0], 'https://a.b');
	assert.equal(buildNoteContent({ clippedAt }).split('\n')[0], '未命名剪藏');
});

test('正文抽空时留一句说明，不产出只有分隔线的空笔记', () => {
	const content = buildNoteContent({ title: 'T', url: 'https://a.b', markdown: '   ' });
	assert.ok(content.endsWith('（未提取到正文，只存了链接）'));
});

test('正文里的多余空行压成一个', () => {
	const content = buildNoteContent({ title: 'T', markdown: 'a\n\n\n\n\nb' });
	assert.ok(content.endsWith('a\n\nb'));
});

test('buildNoteData 用秒级时间戳，markdown / pinned 落到 systemTags', () => {
	const data = buildNoteData({ content: 'x', tags: 'a a b', now: 1_755_000_000_000 });
	assert.equal(data.creationDate, 1_755_000_000);
	assert.equal(data.modificationDate, 1_755_000_000);
	assert.deepEqual(data.systemTags, ['markdown']);
	assert.deepEqual(data.tags, ['a', 'b']);
	assert.equal(data.deleted, false);

	const pinned = buildNoteData({ content: 'x', pinned: true, markdown: false, now: 0 });
	assert.deepEqual(pinned.systemTags, ['pinned']);
});

test('buildNoteData 补齐 publishURL / shareURL —— 缺字段会被别的客户端当空值覆盖', () => {
	const data = buildNoteData({ content: 'x' });
	assert.equal(data.publishURL, '');
	assert.equal(data.shareURL, '');
});
