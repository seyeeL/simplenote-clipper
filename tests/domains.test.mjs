import test from 'node:test';
import assert from 'node:assert/strict';

import { DOMAIN_TAGS, domainTag } from '../lib/domains.js';

test('映射命中时用中文标签', () => {
	assert.equal(domainTag('https://mp.weixin.qq.com/s/abcdef'), '公众号');
	assert.equal(domainTag('https://weibo.com/1088413295/5113631702256640'), '微博');
	assert.equal(domainTag('https://www.zhihu.com/question/1'), '知乎');
});

test('子域继承父域的标签', () => {
	assert.equal(domainTag('https://zhuanlan.zhihu.com/p/123'), '知乎');
	assert.equal(domainTag('https://m.weibo.cn/detail/1'), '微博');
});

test('后缀匹配取最长的一条，不受 DOMAIN_TAGS 书写顺序影响', () => {
	// 这条是回归用的：曾经按 Object.entries 顺序返回第一条命中，
	// 一旦有人往表里加 qq.com，mp.weixin.qq.com 的子域就会被抢走
	assert.equal(domainTag('https://a.mp.weixin.qq.com/s/x'), '公众号');
});

test('没命中的域名退回主机名，去掉 www.', () => {
	assert.equal(domainTag('https://www.example.com/a'), 'example.com');
	assert.equal(domainTag('https://blog.example.com/a'), 'blog.example.com');
});

test('主机名统一转小写', () => {
	assert.equal(domainTag('https://WWW.Example.COM/a'), 'example.com');
	assert.equal(domainTag('https://MP.Weixin.QQ.com/s/x'), '公众号');
});

test('URL 解析不了时返回空串，交给调用方跳过', () => {
	assert.equal(domainTag('不是个 URL'), '');
	assert.equal(domainTag(''), '');
	assert.equal(domainTag(null), '');
});

test('映射表里没有带 www. 或协议前缀的脏 key', () => {
	for (const key of Object.keys(DOMAIN_TAGS)) {
		assert.ok(!key.startsWith('www.'), `${key} 不该带 www.`);
		assert.ok(!key.includes('/'), `${key} 只写域名，不写路径`);
		assert.equal(key, key.toLowerCase(), `${key} 要全小写`);
	}
});
