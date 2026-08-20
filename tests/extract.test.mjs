import test from 'node:test';
import assert from 'node:assert/strict';

import { shouldDropByClass, stripSiteSuffix } from '../lib/extract.js';

test('明确的噪声容器，文字再多也删', () => {
	assert.equal(
		shouldDropByClass({ className: 'related-posts', textLength: 5000 }),
		true,
	);
	assert.equal(shouldDropByClass({ className: 'comment-list', textLength: 5000 }), true);
	assert.equal(shouldDropByClass({ id: 'sidebar', textLength: 5000 }), true);
});

test('回归：公众号正文挂在 p.share_notice_inner 上，不能按类名删掉', () => {
	// 真实页面 https://mp.weixin.qq.com/s/QpoEDH56bWI_7P6WjJu7KQ：
	// 整篇正文（718 字符）就在这个 class 里，旧规则命中 share 直接删光，只剩标题
	assert.equal(
		shouldDropByClass({
			className: 'share_notice_inner js_underline_content js_text_desc',
			textLength: 718,
			getLinkTextLength: () => 0,
		}),
		false,
	);
});

test('弱证据 + 文字量小 = 真噪声，照删', () => {
	assert.equal(shouldDropByClass({ className: 'share-buttons', textLength: 12 }), true);
	assert.equal(shouldDropByClass({ className: 'wx_bottom_modal', textLength: 90 }), true);
	assert.equal(shouldDropByClass({ className: 'site-footer', textLength: 40 }), true);
});

test('弱证据 + 文字量大但全是链接 = 推荐位，照删', () => {
	assert.equal(
		shouldDropByClass({
			className: 'footer-nav',
			textLength: 800,
			getLinkTextLength: () => 700,
		}),
		true,
	);
});

test('没命中任何噪声词就不删，也不去扫链接', () => {
	let scanned = false;
	assert.equal(
		shouldDropByClass({
			className: 'article-body',
			textLength: 3000,
			getLinkTextLength: () => {
				scanned = true;
				return 0;
			},
		}),
		false,
	);
	// 链接扫描是懒的：整页每个节点都扫一遍子树，长文章会卡
	assert.equal(scanned, false);
});

test('文字量不到线就短路，同样不扫链接', () => {
	let scanned = false;
	shouldDropByClass({
		className: 'share-bar',
		textLength: 10,
		getLinkTextLength: () => {
			scanned = true;
			return 0;
		},
	});
	assert.equal(scanned, false);
});

test('噪声词要整词匹配，不误伤 shareholder / navigator 这类词', () => {
	assert.equal(shouldDropByClass({ className: 'shareholder-report', textLength: 10 }), false);
	assert.equal(shouldDropByClass({ className: 'navigation-free-content', textLength: 10 }), false);
});

test('stripSiteSuffix 切掉 document.title 的站点后缀', () => {
	assert.equal(stripSiteSuffix('文章标题 - 某站', '某站'), '文章标题');
	assert.equal(stripSiteSuffix('文章标题 | 某站', '某站'), '文章标题');
	assert.equal(stripSiteSuffix('文章标题', '某站'), '文章标题');
	// 整个标题就是站点名时别切成空串
	assert.equal(stripSiteSuffix('某站', '某站'), '某站');
	assert.equal(stripSiteSuffix('标题 - a.b', 'a.b'), '标题');
});
