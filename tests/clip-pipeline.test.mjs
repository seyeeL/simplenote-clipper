// 提取 → 拼笔记的集成用例。提取本身的测试在 web-extract 仓库，这里只管两边接上之后
// 写进 Simplenote 的那份正文对不对。
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';

import { extractArticle } from '../lib/extract.js';
import { htmlToMarkdown } from '../lib/html2md.js';
import { buildNoteContent, toDateString } from '../lib/note.js';

test('X 长文章：笔记里的发布时间是正确日期，不是 Reply 链接里的 17', () => {
	const { document } = parseHTML(`<html><body>
		<article>
			<a href="https://x.com/KinGao476942">Kin</a>
			<div dir="auto"></div>
			<div>
				<h1 dir="auto">做自媒体怎么用好 Grok bot</h1>
				<div><a href="/i/status/2099736121781764594" aria-label="Reply">17</a></div>
				<div class="x-article-body"><div class="contents"><p>前几天有个朋友找我。</p></div></div>
			</div>
			<a href="/KinGao476942/status/2099736121781764594">13:44 · 2026年9月15日</a>
		</article>
	</body></html>`);
	const article = extractArticle(document, 'https://x.com/kingao476942/status/2099736121781764594');
	const published = toDateString(new Date('2026-09-15T05:44:37.300Z'));
	const note = buildNoteContent({ ...article, markdown: htmlToMarkdown(article.root), clippedAt: '2026-09-16' });
	assert.ok(note.includes(`published: ${published}  \n`));
	assert.doesNotMatch(note, /^published: 17\s*$/m);
	assert.match(note, /前几天有个朋友找我。/);
});

test('X 和 Twitter 的 status 来源链接去 query，笔记里存的也是干净链接', () => {
	const { document } = parseHTML('<html><body><article><p>正文</p></article></body></html>');
	for (const canonical of [
		'https://x.com/kingao476942/status/2099736121781764594',
		'https://twitter.com/u/status/123',
	]) {
		const article = extractArticle(document, `${canonical}?s=46&t=tracking`);
		const note = buildNoteContent({ ...article, markdown: htmlToMarkdown(article.root), clippedAt: '2026-09-16' });
		assert.ok(note.includes(`url: ${canonical}  \n`));
		assert.doesNotMatch(note, /\?s=|tracking/);
	}
});

test('公众号日期格式经 toDateString 规范化后写进笔记', () => {
	const { document } = parseHTML(`<html><body>
		<h1 id="activity-name">标题</h1>
		<span id="js_name">某公众号</span>
		<em id="publish_time">2026年8月19日 08:00</em>
		<div id="js_content"><p>${'正文段落。'.repeat(60)}</p></div>
	</body></html>`);
	const article = extractArticle(document, 'https://mp.weixin.qq.com/s/abc');
	const note = buildNoteContent({ ...article, markdown: htmlToMarkdown(article.root), clippedAt: '2026-09-16' });
	assert.ok(note.startsWith('标题\n'));
	assert.ok(note.includes('author: 某公众号  \n'));
	assert.ok(note.includes('published: 2026-08-19  \n'));
});
