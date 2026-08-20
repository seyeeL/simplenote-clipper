import test from 'node:test';
import assert from 'node:assert/strict';

import { buildRefererRules, collectImageUrls, extensionFor, rewriteImageUrls, sha256Hex, stripImages } from '../lib/images.js';

test('收集正文里的图片地址，按出现顺序去重', () => {
	const md = '![a](https://x/1.png)\n\n文字\n\n![b](https://x/2.jpg)\n\n![c](https://x/1.png)';
	assert.deepEqual(collectImageUrls(md), ['https://x/1.png', 'https://x/2.jpg']);
});

test('非 http(s) 的图片跳过', () => {
	const md = '![a](data:image/png;base64,AAA)\n![b](/local/1.png)\n![c](https://x/ok.png)';
	assert.deepEqual(collectImageUrls(md), ['https://x/ok.png']);
});

test('空正文不炸', () => {
	assert.deepEqual(collectImageUrls(''), []);
	assert.deepEqual(collectImageUrls(null), []);
});

test('替换图片地址时保留 alt', () => {
	const md = '![图 说](https://x/1.png)';
	assert.equal(rewriteImageUrls(md, { 'https://x/1.png': 'https://cdn/a.png' }), '![图 说](https://cdn/a.png)');
});

test('映射里没有的图保持原样 —— 单张上传失败不该动它', () => {
	const md = '![a](https://x/1.png) ![b](https://x/2.png)';
	assert.equal(
		rewriteImageUrls(md, { 'https://x/1.png': 'https://cdn/a.png' }),
		'![a](https://cdn/a.png) ![b](https://x/2.png)',
	);
});

test('只动图片语法里的 URL，正文里同样的普通链接不动', () => {
	// 文章末尾常有「原文链接」，换成图床地址就错了
	const md = '![封面](https://x/1.png)\n\n[原文](https://x/1.png)\n\n裸链接 https://x/1.png';
	const out = rewriteImageUrls(md, { 'https://x/1.png': 'https://cdn/a.png' });
	assert.ok(out.includes('![封面](https://cdn/a.png)'));
	assert.ok(out.includes('[原文](https://x/1.png)'));
	assert.ok(out.includes('裸链接 https://x/1.png'));
});

test('后缀优先信 Content-Type', () => {
	assert.equal(extensionFor('image/png', 'https://x/a'), 'png');
	assert.equal(extensionFor('image/jpeg; charset=binary', 'https://x/a'), 'jpg');
	assert.equal(extensionFor('IMAGE/WEBP', 'https://x/a'), 'webp');
});

test('Content-Type 认不出就看 URL 后缀', () => {
	assert.equal(extensionFor('application/octet-stream', 'https://x/a.gif'), 'gif');
	assert.equal(extensionFor('', 'https://x/a.JPEG'), 'jpg');
});

test('微信图片路径没后缀，格式在 query 的 wx_fmt 里', () => {
	const url = 'https://mmbiz.qpic.cn/mmbiz_png/F1wRK2rOmZz/300?wx_fmt=png&wxfrom=18';
	assert.equal(extensionFor('application/octet-stream', url), 'png');
	assert.equal(extensionFor('', 'https://mmbiz.qpic.cn/x/0?wx_fmt=gif'), 'gif');
});

test('都认不出按 jpg 处理，不产出没有后缀的对象名', () => {
	assert.equal(extensionFor('', 'https://x/a'), 'jpg');
	assert.equal(extensionFor(null, ''), 'jpg');
});

test('sha256Hex 输出 64 位十六进制，同样内容同样结果', async () => {
	const bytes = new TextEncoder().encode('hello');
	const hex = await sha256Hex(bytes);
	assert.match(hex, /^[0-9a-f]{64}$/);
	// 已知向量：sha256("hello")
	assert.equal(hex, '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
});

const weiboRule = { imageReferer: 'https://weibo.com/', imageHosts: ['sinaimg.cn'] };

test('要 Referer 的站点生成一条会话规则', () => {
	const [rule, ...rest] = buildRefererRules(weiboRule, 1);
	assert.equal(rest.length, 0);
	assert.equal(rule.id, 1);
	assert.deepEqual(rule.action.requestHeaders, [
		{ header: 'Referer', operation: 'set', value: 'https://weibo.com/' },
	]);
	assert.equal(rule.condition.urlFilter, '||sinaimg.cn^');
});

test('规则只作用于 service worker 自己发的请求', () => {
	// tabIds -1 = 不属于任何标签页。少了这条会连用户正在看的页面上的请求一起改
	const [rule] = buildRefererRules(weiboRule, 1);
	assert.deepEqual(rule.condition.tabIds, [-1]);
});

test('resourceTypes 覆盖 fetch 可能被归到的类型', () => {
	// 归错类型规则会静默不生效，图还是 403，很难查
	const [rule] = buildRefererRules(weiboRule, 1);
	assert.ok(rule.condition.resourceTypes.includes('xmlhttprequest'));
	assert.ok(rule.condition.resourceTypes.includes('other'));
});

test('多个图片域名各给一条，id 顺着排', () => {
	const rules = buildRefererRules({ imageReferer: 'https://x.com/', imageHosts: ['a.com', 'b.com'] }, 7);
	assert.deepEqual(rules.map((r) => r.id), [7, 8]);
	assert.deepEqual(rules.map((r) => r.condition.urlFilter), ['||a.com^', '||b.com^']);
});

test('没配 Referer 的站点不生成规则', () => {
	assert.deepEqual(buildRefererRules({ imageHosts: ['a.com'] }), []);
	assert.deepEqual(buildRefererRules({ imageReferer: 'https://x.com/' }), []);
	assert.deepEqual(buildRefererRules(null), []);
	assert.deepEqual(buildRefererRules(undefined), []);
});

test('不保存图片：图删掉，文字留着', () => {
	const md = '一段话\n\n![配图](https://a.com/1.jpg)\n\n下一段';
	const { markdown, removed } = stripImages(md);
	assert.equal(markdown, '一段话\n\n下一段');
	assert.equal(removed, 1);
});

test('图外面套着链接也一起删干净', () => {
	// 很多站点的插图可以点开大图，删完只剩 [](href) 就成了指向不明的空链接
	const md = '前\n\n[![大图](https://a.com/1.jpg)](https://a.com/1.jpg)\n\n后';
	const { markdown, removed } = stripImages(md);
	assert.equal(markdown, '前\n\n后');
	assert.equal(removed, 1);
	assert.ok(!markdown.includes('['));
});

test('行内图删掉不动周围的字', () => {
	const { markdown, removed } = stripImages('看这个 ![梗图](https://a.com/x.png) 挺逗');
	assert.equal(markdown, '看这个  挺逗');
	assert.equal(removed, 1);
});

test('连着好几张图只留一个空行', () => {
	const md = '前\n\n![](https://a.com/1.jpg)\n\n![](https://a.com/2.jpg)\n\n![](https://a.com/3.jpg)\n\n后';
	const { markdown, removed } = stripImages(md);
	assert.equal(markdown, '前\n\n后');
	assert.equal(removed, 3);
});

test('普通链接不受影响', () => {
	const md = '见 [文档](https://a.com/doc) 和 ![图](https://a.com/1.jpg)';
	const { markdown, removed } = stripImages(md);
	assert.equal(markdown, '见 [文档](https://a.com/doc) 和');
	assert.equal(removed, 1);
});

test('没有图就原样返回', () => {
	assert.deepEqual(stripImages('只有文字'), { markdown: '只有文字', removed: 0 });
	assert.deepEqual(stripImages(''), { markdown: '', removed: 0 });
	assert.deepEqual(stripImages(null), { markdown: '', removed: 0 });
});
