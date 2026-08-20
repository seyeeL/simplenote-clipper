import test from 'node:test';
import assert from 'node:assert/strict';

import { SITE_RULES, ruleFor } from '../lib/site-rules.js';

const weibo = SITE_RULES.find((r) => r.name === '微博');

test('按 hostname 命中规则', () => {
	assert.equal(ruleFor('https://mp.weixin.qq.com/s/abc')?.name, '微信公众号');
	assert.equal(ruleFor('https://weibo.com/1088413295/5113631702256640')?.name, '微博');
});

test('子域继承', () => {
	assert.equal(ruleFor('https://m.weibo.cn/detail/1')?.name, '微博');
	assert.equal(ruleFor('https://www.weibo.com/x')?.name, '微博');
});

test('没配的站点走通用逻辑，不返回规则', () => {
	assert.equal(ruleFor('https://example.com/a'), null);
	// qq.com 下别的子域不该被公众号规则吃掉
	assert.equal(ruleFor('https://news.qq.com/a'), null);
});

test('URL 解析不了不炸', () => {
	assert.equal(ruleFor('不是个 URL'), null);
	assert.equal(ruleFor(''), null);
	assert.equal(ruleFor(null), null);
});

test('微博的两位年份补成四位', () => {
	assert.equal(weibo.normalizePublished('24-12-20 12:17'), '2024-12-20 12:17');
	// 已经是四位的别动
	assert.equal(weibo.normalizePublished('2024-12-20 12:17'), '2024-12-20 12:17');
	// 不是这个形状的原样返回
	assert.equal(weibo.normalizePublished('今天 12:17'), '今天 12:17');
});

test('规则表每条都写全了必填项', () => {
	for (const rule of SITE_RULES) {
		assert.ok(rule.name, '每条规则要有 name，doc 和报错里都用得上');
		assert.ok(Array.isArray(rule.hosts) && rule.hosts.length, `${rule.name} 缺 hosts`);
		for (const host of rule.hosts) {
			assert.equal(host, host.toLowerCase(), `${rule.name} 的 ${host} 要全小写`);
			assert.ok(!host.startsWith('www.'), `${rule.name} 的 ${host} 不该带 www.`);
			assert.ok(!host.includes('/'), `${rule.name} 的 ${host} 只写域名`);
		}
		assert.ok(rule.root, `${rule.name} 至少要指明正文在哪`);
	}
});

test('规则表顺序不影响结果 —— 每个 host 只该命中一条', () => {
	for (const rule of SITE_RULES) {
		for (const host of rule.hosts) {
			const hits = SITE_RULES.filter((r) =>
				r.hosts.some((h) => host === h || host.endsWith(`.${h}`)),
			);
			assert.equal(hits.length, 1, `${host} 命中了 ${hits.length} 条规则，规则表有重叠`);
		}
	}
});
