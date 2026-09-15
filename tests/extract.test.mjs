import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';
import { htmlToMarkdown } from '../lib/html2md.js';
import { buildNoteContent, toDateString } from '../lib/note.js';

import {
	dropNested,
	extractArticle,
	keepGuard,
	keepLineBreaks,
	quoteBlocks,
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

/** quoteBlocks 要 matches / querySelectorAll / replaceWith，最小 stub 一个。 */
function quoteBox(inner) {
	const doc = fakeDoc();
	const root = doc.adopt(el('div', {}, [inner]));
	root.matches = () => false;
	root.querySelectorAll = (selector) => (selector === 'article' ? [inner] : []);
	inner.matches = (selector) => selector === 'article';
	inner.querySelectorAll = () => [];
	return { doc, root };
}

test('quoteBlocks 把点名的块套成引用段', () => {
	const inner = el('article', {}, ['引用的那条推']);
	const { root } = quoteBox(inner);
	quoteBlocks(root, ['article']);
	assert.equal(root.childNodes[0].nodeName, 'BLOCKQUOTE');
	assert.equal(root.textContent, '引用的那条推');
});

test('规则给了 format 就用重排后的节点顶替原块', () => {
	// 推特的引用推文整块收进来是一堆碎行（昵称、@handle、时间各占一行），
	// 规则自己拼成「抬头 + 正文」再套引用段
	const inner = el('article', {}, ['昵称', '@handle', '8月2日', '正文']);
	const { doc, root } = quoteBox(inner);
	quoteBlocks(root, ['article'], (d, el_) => {
		assert.equal(el_, inner, 'format 拿到的是被点名的那个块');
		return [d.createElement('p')].map((p) => {
			p.appendChild(doc.createTextNode('重排过了'));
			return p;
		});
	});
	assert.equal(root.textContent, '重排过了');
});

test('format 返回空或者报错，还照原样收', () => {
	// 重排失败把整块内容弄丢的话，剪出来的笔记会少一条推
	for (const format of [() => [], () => null, () => { throw new Error('boom'); }]) {
		const inner = el('article', {}, ['引用的那条推']);
		const { root } = quoteBox(inner);
		quoteBlocks(root, ['article'], format);
		assert.equal(root.textContent, '引用的那条推');
	}
});

test('回归：X 长文章不能只剪到封面，正文、标题和段落都要留下', () => {
	// 2099736121781764594 的未登录 DOM：普通推文正文为空，长文章另放在 x-article-body。
	// 用离线 DOM 跑真正的选择器；不能用按选择器返回假节点的 stub 验这一层。
	const { document } = parseHTML(`<html><head><title>Kin on X</title></head><body>
		<article>
			<a href="https://x.com/KinGao476942">Kin</a>
			<div dir="auto"></div>
			<div>
				<img src="https://pbs.twimg.com/media/cover?format=webp&amp;name=medium" alt="Article cover image">
				<h1 dir="auto">做自媒体怎么用好 Grok bot</h1>
				<div><a href="/i/status/2099736121781764594" aria-label="Reply">17</a><button>99 Like</button><span>148 Bookmark</span></div>
				<div class="x-article-body break-words">
					<style>.article-style { color: red; }</style>
					<div class="contents">
						<p>前几天有个朋友找我，他用 AI 做了个挺好用的小工具。</p>
						<h2>一、为什么偏偏是现在</h2>
						<p>瓶颈整个挪到了<strong>后半段</strong>。</p>
						<ul><li>先写身份卡</li><li>再建选题表</li></ul>
						<p>这篇如果对你有用，也欢迎在评论区留言。</p>
					</div>
				</div>
			</div>
			<a href="/KinGao476942/status/2099736121781764594">13:44 · 2026年9月15日</a>
			<span>1.4万 Views</span>
		</article>
		<article><a href="/other/status/2099748054563688620">9h</a><div dir="auto">这是回复，不是正文</div></article>
		<aside>Log in or sign up for X</aside>
	</body></html>`);
	const before = document.body.innerHTML;
	const article = extractArticle(document, 'https://x.com/kingao476942/status/2099736121781764594');
	const markdown = htmlToMarkdown(article.root);
	assert.equal(article.title, 'Kin on X: 做自媒体怎么用好 Grok bot');
	assert.equal(article.author, 'Kin');
	const published = toDateString(new Date('2026-09-15T05:44:37.300Z'));
	assert.equal(article.publishedAt, published, '发布时间不能取成 Reply 链接里的 17');
	const note = buildNoteContent({ ...article, markdown, clippedAt: '2026-09-16' });
	assert.ok(note.includes(`published: ${published}  \n`));
	assert.doesNotMatch(note, /^published: 17\s*$/m);
	assert.match(markdown, /前几天有个朋友找我，他用 AI 做了个挺好用的小工具。/);
	assert.match(markdown, /## 一、为什么偏偏是现在\n\n瓶颈整个挪到了\*\*后半段\*\*。/);
	assert.match(markdown, /- 先写身份卡\n- 再建选题表/);
	assert.match(markdown, /这篇如果对你有用，也欢迎在评论区留言。/);
	assert.match(markdown, /!\[Article cover image\]\(https:\/\/pbs\.twimg\.com\/media\/cover\?format=webp&name=large\)/);
	assert.doesNotMatch(markdown, /Views|Bookmark|Like|这是回复|Log in|article-style/);
	assert.equal(document.body.innerHTML, before, '只清洗克隆体，不能改页面');
});

test('X 长文章没有 h1 时仍用正文开头和作者包装标题', () => {
	const { document } = parseHTML(`<html><body><article>
		<a href="https://x.com/KinGao476942">Kin</a>
		<a href="/KinGao476942/status/2099736121781764594">2026-09-15</a>
		<div dir="auto"></div>
		<div class="x-article-body"><p>先写身份卡，再建选题表。</p></div>
	</article></body></html>`);
	const article = extractArticle(document, 'https://x.com/KinGao476942/status/2099736121781764594');
	assert.equal(article.title, 'Kin on X: 先写身份卡，再建选题表。');
});

test('X 主推优先用当前 URL 的 snowflake，不用页面上其他日期', () => {
	const { document } = parseHTML(`<html><body><article>
		<time datetime="2025-01-01T12:00:00Z">1月1日</time>
		<a href="/u/status/2099736121781764594">8h</a>
		<div dir="auto">主推正文</div>
	</article></body></html>`);
	const published = toDateString(new Date('2026-09-15T05:44:37.300Z'));
	for (const host of ['x.com', 'twitter.com']) {
		assert.equal(extractArticle(document, `https://${host}/u/status/2099736121781764594`).publishedAt, published);
	}
});

test('X 无法从 URL 取日期时用绝对时间，没有就不把互动数当日期', () => {
	const { document } = parseHTML(`<html><body><article>
		<a href="/i/status/2099736121781764594" aria-label="Reply">17</a>
		<time datetime="2026-09-15T05:44:37.300Z">9月15日</time>
		<div dir="auto">正文</div>
	</article></body></html>`);
	const url = 'https://x.com/u';
	assert.equal(toDateString(extractArticle(document, url).publishedAt), '2026-09-15');
	document.querySelector('time').remove();
	assert.equal(extractArticle(document, url).publishedAt, '');
});

test('X 和 Twitter 的 status 来源链接去 query，保存的笔记也用干净链接', () => {
	const { document } = parseHTML('<html><body><article><p>正文</p></article></body></html>');
	for (const canonical of [
		'https://x.com/kingao476942/status/2099736121781764594',
		'https://twitter.com/u/status/123',
		'https://mobile.twitter.com/u/status/123/photo/1',
		'https://www.x.com/i/web/status/123',
	]) {
		const article = extractArticle(document, `${canonical}?s=46&t=tracking`);
		assert.equal(article.url, canonical);
		const note = buildNoteContent({ ...article, markdown: htmlToMarkdown(article.root), clippedAt: '2026-09-16' });
		assert.ok(note.includes(`url: ${canonical}  \n`));
		assert.doesNotMatch(note, /\?s=|tracking/);
	}
	// 没显式传 URL 时，当前页地址也走同一条规范化路径；只去 query，不动锚点。
	document.location = { href: 'https://x.com/u/status/123?s=46#detail' };
	assert.equal(extractArticle(document).url, 'https://x.com/u/status/123#detail');
});

test('来源链接规范化不改其他站点和非 status 页的查询参数', () => {
	const { document } = parseHTML('<html><body><article><p>正文</p></article></body></html>');
	for (const url of [
		'https://example.com/u/status/123?s=46',
		'https://x.com.evil.example/u/status/123?s=46',
		'https://x.com/search?q=grok',
		'https://twitter.com/u?lang=zh',
		'https://x.com/u/status/not-a-number?s=46',
		'not a URL?s=46',
	]) {
		assert.equal(extractArticle(document, url).url, url);
	}
});
