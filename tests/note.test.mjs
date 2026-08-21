import test from 'node:test';
import assert from 'node:assert/strict';

import {
	authorTag,
	buildNoteContent,
	buildNoteData,
	buildTags,
	normalizeTags,
	stripDuplicateHeading,
	toDateString,
} from '../lib/note.js';

test('标签按空格 / 半角逗号 / 全角逗号切分并去重（忽略大小写）', () => {
	assert.deepEqual(normalizeTags('clip 技术，读书,Clip'), ['clip', '技术', '读书']);
	assert.deepEqual(normalizeTags(['a b', 'c']), ['a', 'b', 'c']);
	assert.deepEqual(normalizeTags(''), []);
	assert.deepEqual(normalizeTags(null), []);
});

test('标签超长截断到 64 字符', () => {
	assert.equal(normalizeTags('x'.repeat(100))[0].length, 64);
});

test('作者名整体当一个标签，内部空格换连字符', () => {
	assert.equal(authorTag('张三'), '张三');
	assert.equal(authorTag('  John  Smith '), 'John-Smith');
	assert.equal(authorTag(''), '');
	assert.equal(authorTag(null), '');
});

test('作者字段抓到整段简介时不打标签（>40 字符）', () => {
	const bio = '这是一段被误当成作者名抓下来的自我介绍文字内容还在继续继续继续继续继续继续继续继续继续继续';
	assert.ok(bio.length > 40);
	assert.equal(authorTag(bio), '');
	// 边界：正好 40 字符仍然打标签
	assert.equal(authorTag('x'.repeat(40)), 'x'.repeat(40));
	assert.equal(authorTag('x'.repeat(41)), '');
});

test('默认只有手填标签，作者和域名都不加', () => {
	assert.deepEqual(
		buildTags({ tags: 'clip 技术', author: '张三', url: 'https://mp.weixin.qq.com/s/abc' }),
		['clip', '技术'],
	);
});

test('开了开关才加作者 / 站点标签，并去重', () => {
	assert.deepEqual(
		buildTags({
			tags: 'clip 技术',
			author: '张三',
			url: 'https://mp.weixin.qq.com/s/abc',
			withAuthor: true,
			withSite: true,
		}),
		['clip', '技术', '张三', '公众号'],
	);
	// 两个开关互不影响
	assert.deepEqual(
		buildTags({ tags: 'clip', author: '张三', url: 'https://weibo.com/x', withAuthor: true }),
		['clip', '张三'],
	);
	assert.deepEqual(
		buildTags({ tags: 'clip', author: '张三', url: 'https://weibo.com/x', withSite: true }),
		['clip', '微博'],
	);
	// 手填标签里已经有站点名时不重复加
	assert.deepEqual(
		buildTags({ tags: '公众号', url: 'https://mp.weixin.qq.com/s/abc', withSite: true }),
		['公众号'],
	);
});

test('没有作者或 URL 时 buildTags 不产出空标签', () => {
	assert.deepEqual(buildTags({ tags: 'clip', withAuthor: true, withSite: true }), ['clip']);
	assert.deepEqual(
		buildTags({ tags: 'clip', url: '不是个 URL', withAuthor: true, withSite: true }),
		['clip'],
	);
});

test('toDateString 吃 ISO / Date / 时间戳，解析不出来就原样返回', () => {
	assert.equal(toDateString('2026-08-20T12:00:00Z'), toDateString(new Date('2026-08-20T12:00:00Z')));
	assert.equal(toDateString(new Date(2026, 7, 20)), '2026-08-20');
	assert.equal(toDateString('民国八十年'), '民国八十年');
	// 公众号 #publish_time 是中文格式，Date 直接解析会 NaN
	assert.equal(toDateString('2026年8月19日 11:56'), '2026-08-19');
	assert.equal(toDateString('2026/8/9'), '2026-08-09');
	assert.equal(toDateString('2024-12-20'), '2024-12-20');
	assert.equal(toDateString(''), '');
	assert.equal(toDateString(null), '');
});

test('第一行是纯标题，第二行紧跟 --- —— setext 写法，预览是 H1，列表显示的仍是纯标题', () => {
	const content = buildNoteContent({
		title: '标题\n带换行',
		url: 'https://example.com/a',
		markdown: '正文',
		clippedAt: new Date(2026, 7, 20),
	});
	const lines = content.split('\n');
	assert.equal(lines[0], '标题 带换行');
	assert.equal(lines[1], '---');
	assert.equal(lines[2], '');
});

test('titleHeading 开着时用 # 标题，就不再补 ---，免得一个标题套两种写法', () => {
	const base = { title: '标题', url: 'https://a.b', markdown: '正文', clippedAt: new Date(2026, 7, 20) };
	const lines = buildNoteContent({ ...base, titleHeading: true }).split('\n');
	assert.equal(lines[0], '# 标题');
	assert.equal(lines[1], '');
	assert.ok(!lines.includes('---'));
});

test('属性区没有收尾的 ---', () => {
	const content = buildNoteContent({
		title: 'T',
		url: 'https://a.b',
		markdown: '正文',
		clippedAt: new Date(2026, 7, 20),
	});
	// 只有标题下面那一条 setext 横线
	assert.equal(content.split('\n').filter((l) => l === '---').length, 1);
});

test('作者排在 url 后面，同时也进标签', () => {
	const content = buildNoteContent({
		title: 'T',
		url: 'https://a.b',
		author: '  李  四 ',
		markdown: '正文',
		clippedAt: new Date(2026, 7, 20),
	});
	const keys = content.split('\n').filter((l) => l.includes(': ')).map((l) => l.split(':')[0]);
	assert.deepEqual(keys, ['url', 'author', 'created']);
	assert.ok(content.includes('author: 李 四  \n'));
	// 标签那份把空格换成连字符，两处不是同一个形态
	assert.deepEqual(
		buildTags({ author: '李  四', url: 'https://a.b', withAuthor: true, withSite: true }),
		['李-四', 'a.b'],
	);
});

test('没抓到作者就不写 author 行，不留空值', () => {
	const content = buildNoteContent({ title: 'T', url: 'https://a.b', clippedAt: new Date(2026, 7, 20) });
	assert.ok(!content.includes('author:'));
});

test('正文开头和标题重复的 heading 去掉，不留两行标题', () => {
	const content = buildNoteContent({
		title: '一个人状态变差，往往是从不想见人开始的',
		url: 'https://a.b',
		markdown: '# 一个人状态变差，往往是从不想见人开始的\n\n很多人生活一不顺…',
		clippedAt: new Date(2026, 7, 20),
	});
	assert.equal(content.match(/一个人状态变差/g).length, 1);
	assert.ok(content.endsWith('很多人生活一不顺…'));
});

test('正文 heading 和标题不一致时保留 —— 那是文章自己的小节标题', () => {
	const content = buildNoteContent({
		title: '文章标题',
		markdown: '## 第一节\n\n正文',
		clippedAt: new Date(2026, 7, 20),
	});
	assert.ok(content.includes('## 第一节'));
});

test('去重比较忽略空白差异，但不做模糊匹配', () => {
	assert.equal(stripDuplicateHeading('#  标题  中间空格\n\n正文', '标题 中间空格'), '正文');
	assert.equal(stripDuplicateHeading('# 标题前缀更长一些\n\n正文', '标题前缀'), '# 标题前缀更长一些\n\n正文');
	assert.equal(stripDuplicateHeading('正文没有 heading', '标题'), '正文没有 heading');
	assert.equal(stripDuplicateHeading('# 标题', ''), '# 标题');
});

test('整篇的最终形状', () => {
	const content = buildNoteContent({
		title: '2019年，我的极简高效生活管理法',
		url: 'https://mp.weixin.qq.com/s/A4wmSktp8Zbui2CB8th_CA',
		author: 'Lachel',
		publishedAt: '2019-12-26',
		markdown: '正文',
		clippedAt: new Date(2026, 7, 20),
	});
	assert.equal(
		content,
		[
			'2019年，我的极简高效生活管理法',
			'---',
			'',
			'url: https://mp.weixin.qq.com/s/A4wmSktp8Zbui2CB8th_CA  ',
			'author: Lachel  ',
			'published: 2019-12-26  ',
			'created: 2026-08-20  ',
			'',
			'正文',
		].join('\n'),
	);
});

test('发布日期抓不到时省略 published 行，不写空值', () => {
	const content = buildNoteContent({
		title: 'T',
		url: 'https://a.b',
		markdown: '正文',
		clippedAt: new Date(2026, 7, 20),
	});
	assert.ok(!content.includes('published:'));
	assert.ok(content.includes('created: 2026-08-20'));
});

test('站点只进标签，不进属性区', () => {
	const content = buildNoteContent({
		title: 'T',
		url: 'https://a.b',
		siteName: '某站',
		markdown: '正文',
	});
	assert.ok(!content.includes('某站'));
});

test('标题为空时退到站点名，再退到 URL', () => {
	const clippedAt = new Date(2026, 7, 20);
	assert.equal(buildNoteContent({ siteName: '某站', url: 'https://a.b', clippedAt }).split('\n')[0], '某站');
	assert.equal(buildNoteContent({ url: 'https://a.b', clippedAt }).split('\n')[0], 'https://a.b');
	assert.equal(buildNoteContent({ clippedAt }).split('\n')[0], '未命名剪藏');
});

test('正文抽空时留一句说明，不产出只有 frontmatter 的空笔记', () => {
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

test('属性行末尾是两个空格', () => {
	// markdown 的硬换行写法。桌面端一个空格还能断开，移动端预览少一个就把几行并成一段
	const content = buildNoteContent({
		title: 'T',
		url: 'https://a.b',
		author: '某某',
		publishedAt: '2026-08-01',
		clippedAt: new Date(2026, 7, 20),
	});
	const props = content.split('\n').filter((line) => /^(url|author|published|created): /.test(line));
	assert.equal(props.length, 4);
	for (const line of props) {
		assert.ok(line.endsWith('  '), `${JSON.stringify(line)} 末尾要有两个空格`);
		assert.ok(!line.endsWith('   '), `${JSON.stringify(line)} 多了一个空格`);
	}
});
