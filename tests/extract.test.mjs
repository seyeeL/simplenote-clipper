import test from 'node:test';
import assert from 'node:assert/strict';

import {
	dropNested,
	keepGuard,
	keepLineBreaks,
	shouldDropByClass,
	stripSiteSuffix,
	stripText,
	textNodesIn,
} from '../lib/extract.js';
import { el, fakeDoc, text } from './fake-dom.mjs';

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

// keepGuard 只用 matches / querySelectorAll / contains，手搓这三个就够
function guardBox(selector, children = []) {
	const node = { selector, children };
	node.matches = (s) => s === selector;
	node.contains = (other) =>
		other !== node && children.some((c) => c === other || c.contains?.(other));
	node.querySelectorAll = (s) =>
		children.flatMap((c) => [...(c.matches?.(s) ? [c] : []), ...(c.querySelectorAll?.(s) ?? [])]);
	return node;
}

test('keep 名单里的块连同子树都不按类名判噪声', () => {
	// 公众号贴图页：p.share_notice 命中弱证据词 share，字数又不到保命线；
	// 里面的 a.js_common_share_desc_link 同样命中，只保护外层链接文字还是会没
	const link = guardBox('a.js_common_share_desc_link');
	const desc = guardBox('#js_image_desc', [link]);
	const junk = guardBox('.wx_bottom_modal');
	const clone = guardBox('#wrapper', [desc, junk]);

	const isKept = keepGuard(clone, ['#js_image_desc']);
	assert.equal(isKept(desc), true);
	assert.equal(isKept(link), true, '子树也要豁免');
	assert.equal(isKept(junk), false, '名单外的照旧走噪声过滤');
});

test('没配 keep 时不豁免任何元素', () => {
	const clone = guardBox('#wrapper', [guardBox('.share-bar')]);
	const isKept = keepGuard(clone, []);
	assert.equal(isKept(clone.children[0]), false);
	// 选择器一个都没命中也一样
	assert.equal(keepGuard(clone, ['#nope'])(clone.children[0]), false);
});

test('keep 的选择器命中容器自身时也算数', () => {
	// root 只有一个块时 pickRuleRoot 直接把它当容器，querySelectorAll 找不到它自己
	const clone = guardBox('#js_image_desc');
	assert.equal(keepGuard(clone, ['#js_image_desc'])(clone), true);
});

// dropNested 只用 contains，手搓两个字段就够
function box(name, children = []) {
	const node = { name, children };
	node.contains = (other) =>
		other !== node && children.some((c) => c === other || c.contains?.(other));
	return node;
}

test('嵌套的匹配只留最外层', () => {
	// 微博：兜底的 wbtext 就套在 wbpro-feed-content 里，两块都收正文会重复一遍
	const text = box('wbtext');
	const feed = box('feed-content', [text]);
	assert.deepEqual(dropNested([feed, text]), [feed]);
	// 顺序反过来结果一样
	assert.deepEqual(dropNested([text, feed]), [feed]);
});

test('平级的匹配都留着，顺序不变', () => {
	const a = box('a');
	const b = box('b');
	assert.deepEqual(dropNested([a, b]), [a, b]);
});

test('同一个元素被多个选择器命中只算一次', () => {
	const a = box('a');
	assert.deepEqual(dropNested([a, a]), [a]);
});

test('三层嵌套只留最外层', () => {
	const inner = box('inner');
	const mid = box('mid', [inner]);
	const outer = box('outer', [mid, inner]);
	assert.deepEqual(dropNested([outer, mid, inner]), [outer]);
});

test('没有 contains 的节点不炸', () => {
	const bare = { name: 'bare' };
	assert.deepEqual(dropNested([bare]), [bare]);
	assert.deepEqual(dropNested([]), []);
});

test('textNodesIn 按顺序收齐整棵树的文本节点', () => {
	const tree = el('div', {}, ['一', el('span', {}, ['二', el('b', {}, ['三'])]), '四']);
	assert.deepEqual(textNodesIn(tree).map((n) => n.textContent), ['一', '二', '三', '四']);
	assert.deepEqual(textNodesIn(el('div')), []);
	assert.deepEqual(textNodesIn(null), []);
});

test('stripText 抹掉占位符，别的字不动', () => {
	// 小红书话题标签里夹着 [eoi]，页面上是个小图标，取 textContent 就露出来了
	const tree = el('div', {}, [el('span', {}, ['#披荆斩棘的哥哥']), el('span', {}, ['[eoi]']), el('span', {}, ['#'])]);
	stripText(tree, [/\[eoi\]/g]);
	assert.equal(tree.textContent, '#披荆斩棘的哥哥#');
});

test('stripText 一个文本节点里出现多次也清干净', () => {
	const tree = el('div', {}, ['a[eoi]b[eoi]c']);
	stripText(tree, [/\[eoi\]/g]);
	assert.equal(tree.textContent, 'abc');
});

test('没配 stripText 就一个字都不碰', () => {
	const tree = el('div', {}, ['[eoi] 留着']);
	stripText(tree, []);
	stripText(tree);
	assert.equal(tree.textContent, '[eoi] 留着');
});

/** 只命中容器自身的最小 stub：keepLineBreaks 要 matches / querySelectorAll。 */
function lineBreakBox(...children) {
	const doc = fakeDoc();
	const node = doc.adopt(el('div', { id: 'detail-desc' }, children));
	node.matches = (selector) => selector === '#detail-desc';
	node.querySelectorAll = () => [];
	return node;
}

test('keepLineBreaks 把文本里的换行换成 <br>', () => {
	// 小红书正文靠 CSS white-space 把 \n 显示成换行，HTML 里既没有 <p> 也没有 <br>，
	// 照通用规则当空白压掉的话整篇文案会挤成一行
	const box = lineBreakBox('第一段\n第二段');
	keepLineBreaks(box, ['#detail-desc']);
	assert.deepEqual(
		box.childNodes.map((n) => (n.nodeType === 1 ? n.nodeName : n.textContent)),
		['第一段', 'BR', '第二段'],
	);
});

test('连着两个换行留两个 <br>，收口时会变成分段', () => {
	const box = lineBreakBox('上\n\n下');
	keepLineBreaks(box, ['#detail-desc']);
	assert.deepEqual(
		box.childNodes.map((n) => (n.nodeType === 1 ? n.nodeName : n.textContent)),
		['上', 'BR', 'BR', '下'],
	);
});

test('没有换行的文本节点原样留着', () => {
	const box = lineBreakBox('一整行');
	keepLineBreaks(box, ['#detail-desc']);
	assert.deepEqual(box.childNodes.map((n) => n.textContent), ['一整行']);
});

test('没点名的选择器不动', () => {
	const box = lineBreakBox('第一段\n第二段');
	keepLineBreaks(box, ['#other']);
	keepLineBreaks(box, []);
	assert.deepEqual(box.childNodes.map((n) => n.textContent), ['第一段\n第二段']);
});
