import test from 'node:test';
import assert from 'node:assert/strict';

import { SITE_RULES, ruleFor, upgradeSinaImage, upgradeTwimgImage } from '../lib/site-rules.js';
// 推特页面上的时间戳最后要落成笔记里的日期，这一段是跨模块的约定，一起测
import { toDateString } from '../lib/note.js';
import { el, fakeDoc } from './fake-dom.mjs';

const wx = SITE_RULES.find((r) => r.name === '微信公众号');
const weibo = SITE_RULES.find((r) => r.name === '微博');
const xhs = SITE_RULES.find((r) => r.name === '小红书');
const x = SITE_RULES.find((r) => r.name === 'X（推特）');

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

test('公众号规则同时管住普通图文和贴图型', () => {
	const roots = Array.isArray(wx.root) ? wx.root : [wx.root];
	// 贴图页（图片消息）的文案和图片是分开的两块，都不在 #js_content 下
	assert.ok(roots.includes('#js_image_desc'), '贴图页的文案在这一段里');
	assert.ok(
		roots.some((s) => s.includes('.swiper_item_img')),
		'贴图页的图片在顶部 swiper 里',
	);
	// 顶上还有个 aria-hidden 的占位 swiper，装着同一张首图；不限定范围首图会重复
	assert.ok(
		roots.every((s) => !s.includes('.swiper_item_img') || s.includes('#page_top_area')),
		'图片选择器要限定在 #page_top_area 下，否则占位 swiper 的首图会重复一遍',
	);
	// 贴图页上 #js_content 装的是赞赏面板那堆，两条路必须互斥：都命中的话嵌套去重
	// 只会留下 #js_content，文案反而丢了
	const article = roots.find((s) => s.startsWith('#js_content'));
	assert.ok(article, '普通图文仍旧走 #js_content');
	assert.ok(article.includes(':not('), `${article} 会在贴图页上也命中`);
});

test('公众号分享型页面也要能取到号名', () => {
	// 贴图页和纯文字分享页都没有 #js_name，meta author 还常是空串
	assert.ok(wx.author.includes('#js_name'), '普通图文靠这个');
	assert.ok(wx.author.includes('#js_wx_follow_nickname'), '分享型页面的号名在关注条上');
});

test('公众号贴图页的短文案不按类名删', () => {
	// p.share_notice 命中弱证据词 share，一两句话又够不着 200 字的保命线
	assert.deepEqual(wx.keep, ['#js_image_desc']);
});

test('微博的两位年份补成四位', () => {
	assert.equal(weibo.normalizePublished('24-12-20 12:17'), '2024-12-20 12:17');
	// 回归：月日不补零，旧正则只认两位，26-8-13 这种原样漏过去了
	assert.equal(weibo.normalizePublished('26-8-13 12:19'), '2026-08-13 12:19');
	assert.equal(weibo.normalizePublished('26-8-3 09:05'), '2026-08-03 09:05');
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

test('微博缩略图换成原图', () => {
	// 真实页面 https://weibo.com/2954851423/5331427143191023 的九宫格：orj360 只有 14 KB，
	// 截图里的字全糊了；large 是原图 477 KB
	assert.equal(
		upgradeSinaImage('https://wx1.sinaimg.cn/orj360/b01f745fgy1ig230gz5unj228e1bo4b6.jpg'),
		'https://wx1.sinaimg.cn/large/b01f745fgy1ig230gz5unj228e1bo4b6.jpg',
	);
	assert.equal(
		upgradeSinaImage('https://wx2.sinaimg.cn/mw690/abc.jpg'),
		'https://wx2.sinaimg.cn/large/abc.jpg',
	);
	// 已经是原图就别动
	assert.equal(upgradeSinaImage('https://wx1.sinaimg.cn/large/abc.jpg'), 'https://wx1.sinaimg.cn/large/abc.jpg');
});

test('只认得出的尺寸段才换，别的图一律不碰', () => {
	// 头像：尺寸段是 crop.0.0.1080.1080.180，换成 large 会 404
	const avatar = 'https://tvax2.sinaimg.cn/crop.0.0.1080.1080.180/b01f745fly8ifzyu8x8obj20u00u0goc.jpg?KID=imgbed,tva';
	assert.equal(upgradeSinaImage(avatar), avatar);
	// 表情：不是 sinaimg.cn
	const emoji = 'https://face.t.sinajs.cn/t4/appstyle/expression/ext/normal/70/2024_takearest_mobile.png';
	assert.equal(upgradeSinaImage(emoji), emoji);
	// 别的站点的图
	assert.equal(upgradeSinaImage('https://example.com/orj360/a.jpg'), 'https://example.com/orj360/a.jpg');
	// 域名后缀要整段匹配，不能被 notsinaimg.cn.evil.com 这种骗过去
	assert.equal(upgradeSinaImage('https://sinaimg.cn.evil.com/orj360/a.jpg'), 'https://sinaimg.cn.evil.com/orj360/a.jpg');
});

test('upgradeSinaImage 收到脏输入不炸', () => {
	assert.equal(upgradeSinaImage(''), '');
	assert.equal(upgradeSinaImage(null), '');
	assert.equal(upgradeSinaImage('不是个 URL'), '不是个 URL');
	// 只有尺寸段没有文件名
	assert.equal(upgradeSinaImage('https://wx1.sinaimg.cn/orj360/'), 'https://wx1.sinaimg.cn/orj360/');
});

test('微博规则同时覆盖正文和配图', () => {
	const roots = Array.isArray(weibo.root) ? weibo.root : [weibo.root];
	// wbpro-feed-content 是正文 + 九宫格的共同外层，不带构建 hash
	assert.ok(roots.includes('.wbpro-feed-content'), '配图靠这个容器一起带出来');
	assert.equal(typeof weibo.rewriteImageSrc, 'function', '缩略图要换原图');
});

test('带 hash 的类名只匹配稳定的那一段', () => {
	// _wbtext_1h76l_19 里 1h76l 是构建 hash，微博一发版就变
	const withHash = [weibo.author, weibo.published].join(' ');
	assert.ok(!/_[a-z0-9]{5}_\d+/.test(withHash), `选择器里写死了构建 hash：${withHash}`);
});

test('按 hostname 命中小红书', () => {
	assert.equal(ruleFor('https://www.xiaohongshu.com/explore/6a7dd7f7?xsec_token=x')?.name, '小红书');
	assert.equal(ruleFor('https://xiaohongshu.com/explore/1')?.name, '小红书');
});

test('小红书时间去掉「编辑于」前缀和末尾的发布地点', () => {
	assert.equal(xhs.normalizePublished('6天前 重庆'), '6天前');
	assert.equal(xhs.normalizePublished('编辑于 昨天 14:07'), '昨天 14:07');
	assert.equal(xhs.normalizePublished('昨天 04:09 北京'), '昨天 04:09');
	// 没有地点的原样留着
	assert.equal(xhs.normalizePublished('08-05'), '08-05');
	assert.equal(xhs.normalizePublished('7小时前'), '7小时前');
	// 「6天前」本身以中文结尾，前面没空格，不该被当成地点切掉
	assert.equal(xhs.normalizePublished('6天前'), '6天前');
});

test('小红书规则同时管住图文笔记和视频笔记的噪声', () => {
	assert.ok(xhs.drop.includes('.swiper-slide-duplicate'), 'swiper 复制品会让同一张图出现两次');
	assert.ok(xhs.drop.includes('.player-container'), '视频笔记的播放器 UI 会进正文');
	assert.ok(xhs.drop.includes('img.note-content-emoji'), '正文表情是 <img>，开图床会一张张传');
	assert.deepEqual(xhs.unwrap, ['a.tag'], '话题标签只留文字，不要站内搜索的相对链接');
	assert.deepEqual(xhs.keepLineBreaks, ['#detail-desc'], '正文分段靠文本里的换行');
});

test('小红书没有独立标题的笔记要能退回正文开头', () => {
	assert.equal(xhs.title, '#detail-title');
	assert.equal(xhs.titleFromBody, true);
});

test('stripText 配的是正则，不是字符串', () => {
	for (const rule of SITE_RULES) {
		for (const pattern of rule.stripText ?? []) {
			assert.ok(pattern instanceof RegExp, `${rule.name} 的 stripText 要写正则`);
		}
	}
});

/** publishedFrom 只用 querySelectorAll('script') 和 textContent，手搓就够。 */
function scriptDoc(...texts) {
	return { querySelectorAll: () => texts.map((t) => ({ textContent: t })) };
}

test('小红书从 __INITIAL_STATE__ 里取绝对时间', () => {
	// 页面上只有「6天前」，JSON-LD 的 datePublished 是页面渲染时间（假的）
	const state =
		'window.__INITIAL_STATE__={"feed":{"feeds":[{"time":1700000000000}]},' +
		'"note":{"noteDetailMap":{"6a7dd7f7":{"note":{"time":1786632183000}}}}}';
	const doc = scriptDoc('console.log(1)', state);
	assert.equal(
		xhs.publishedFrom(doc, 'https://www.xiaohongshu.com/explore/6a7dd7f7?xsec_token=x'),
		new Date(1786632183000).toISOString(),
	);
});

test('推荐流里的时间在前面也不会被捡走', () => {
	// 锚到 noteDetailMap 再往后找，就是为了跳过 feed 里别人的时间
	const state =
		'window.__INITIAL_STATE__={"feed":{"time":1700000000000},' +
		'"note":{"noteDetailMap":{"x":{"note":{"time":1786632183000}}}}}';
	const got = xhs.publishedFrom(scriptDoc(state), 'https://www.xiaohongshu.com/explore/x');
	assert.notEqual(got, new Date(1700000000000).toISOString());
	assert.equal(got, new Date(1786632183000).toISOString());
});

test('noteDetailMap 不在时退回按笔记 id 定位', () => {
	const state = 'window.__INITIAL_STATE__={"other":{"time":1700000000000},"6a7dd7f7":{"time":1786632183000}}';
	assert.equal(
		xhs.publishedFrom(scriptDoc(state), 'https://www.xiaohongshu.com/explore/6a7dd7f7'),
		new Date(1786632183000).toISOString(),
	);
});

test('取不到时间就交给下一个来源，不返回瞎猜的值', () => {
	assert.equal(xhs.publishedFrom(scriptDoc('var a = 1'), 'https://www.xiaohongshu.com/explore/x'), '');
	assert.equal(xhs.publishedFrom(scriptDoc(), 'https://www.xiaohongshu.com/explore/x'), '');
	// 有 state 但没有 time 字段
	assert.equal(
		xhs.publishedFrom(scriptDoc('window.__INITIAL_STATE__={"noteDetailMap":{}}'), 'https://x.com/a'),
		'',
	);
	// URL 不是合法地址也不能炸
	assert.equal(xhs.publishedFrom(scriptDoc('window.__INITIAL_STATE__={"time":1786632183000}'), '不是 URL'), '');
	// 页面结构没了还有页面上那个相对时间兜底
	assert.equal(xhs.published, '.bottom-container .date');
});

test('小红书正文排在图片前面', () => {
	// 一条笔记最多九张图，图排前面要翻很久才看得到文案
	assert.deepEqual(xhs.root, ['#detail-desc', '.media-container']);
});

test('按 hostname 命中推特，新旧域名都算', () => {
	assert.equal(ruleFor('https://x.com/yyyole/status/2091554005772321204')?.name, 'X（推特）');
	assert.equal(ruleFor('https://twitter.com/yyyole/status/2091554005772321204')?.name, 'X（推特）');
	assert.equal(ruleFor('https://mobile.twitter.com/a/status/1')?.name, 'X（推特）');
});

test('推特图片换成大图', () => {
	// 页面上给的是 small / medium，存进笔记的截图糊得看不清字
	assert.equal(
		upgradeTwimgImage('https://pbs.twimg.com/media/G8sXm3NWYAAVBAN?format=webp&name=small'),
		'https://pbs.twimg.com/media/G8sXm3NWYAAVBAN?format=webp&name=large',
	);
	assert.equal(
		upgradeTwimgImage('https://pbs.twimg.com/media/HQiQLKqaMAAo8Iz?format=jpg&name=medium'),
		'https://pbs.twimg.com/media/HQiQLKqaMAAo8Iz?format=jpg&name=large',
	);
	// format 不动：webp 没有 orig 档，实测 name=orig 只有 jpg 给，webp 直接 404
	assert.ok(
		upgradeTwimgImage('https://pbs.twimg.com/media/x?format=webp&name=small').includes('format=webp'),
	);
});

test('没有 name 参数的推特图片一律不碰', () => {
	// 头像和视频封面的地址里没有尺寸参数，硬加会 404
	const avatar = 'https://pbs.twimg.com/profile_images/1986002260447707136/lf3UN9Xp_normal.jpg';
	assert.equal(upgradeTwimgImage(avatar), avatar);
	const poster = 'https://pbs.twimg.com/amplify_video_thumb/2091553026377146369/img/704fGZAsnfpGrlW0.jpg';
	assert.equal(upgradeTwimgImage(poster), poster);
	// 别的站点的图，参数长得再像也不动
	assert.equal(
		upgradeTwimgImage('https://example.com/a.jpg?name=small'),
		'https://example.com/a.jpg?name=small',
	);
	// 域名后缀要整段匹配
	assert.equal(
		upgradeTwimgImage('https://twimg.com.evil.com/media/a?name=small'),
		'https://twimg.com.evil.com/media/a?name=small',
	);
	assert.equal(upgradeTwimgImage(null), '');
	assert.equal(upgradeTwimgImage('不是个 URL'), '不是个 URL');
});

test('推特时间戳切掉中间点前面的时分，中英文都能落成日期', () => {
	assert.equal(x.normalizePublished('23:51 · 2026年8月23日'), '2026年8月23日');
	assert.equal(toDateString(x.normalizePublished('23:51 · 2026年8月23日')), '2026-08-23');
	// 英文界面是另一种写法，切完 new Date() 吃得下
	assert.equal(toDateString(x.normalizePublished('11:51 PM · Aug 23, 2026')), '2026-08-23');
	// 老版页面的 <time datetime> 是 ISO 串，里面没有中间点，原样通过
	assert.equal(
		toDateString(x.normalizePublished('2026-08-23T15:51:48.000Z')),
		toDateString('2026-08-23T15:51:48.000Z'),
	);
});

test('推特两代前端的正文选择器要互斥', () => {
	// 老版页面上 dir="auto" 满天飞（昵称、卡片标题都有），两条路一起收会带进一堆噪声
	const roots = x.root;
	const classic = roots.find((s) => s.startsWith('[data-testid="tweetText"]'));
	const modern = roots.find((s) => s.startsWith('div[dir="auto"]'));
	assert.ok(classic && modern, '两代前端各要有一条正文选择器');
	assert.ok(
		modern.includes(':not(article:has([data-testid="tweetText"]) *)'),
		`${modern} 会在老版页面上跟着命中`,
	);
});

test('推特正文只收主推的，引用推文单独成块', () => {
	const roots = x.root;
	// 引用推文是嵌在主推里的另一个 article，混进来会读成同一个人说的
	for (const selector of roots.filter((s) => s !== 'article article')) {
		assert.ok(selector.includes(':not(article article *)'), `${selector} 会把引用推文的内容混进主推`);
	}
	assert.ok(roots.includes('article article'), '引用推文要整块收，不能丢');
	assert.deepEqual(x.blockquote, ['article'], '引用推文划成引用段');
	assert.equal(x.videoPoster, true, '视频存不进笔记，留封面图');
	assert.equal(x.titleFromBody, true, '推文没有标题，取正文开头');
});

/**
 * 手搓一页推文。推特的规则只用这几样：querySelectorAll('article')、按选择器在一条推里
 * 找昵称 / 时间 / 正文、closest('article')。这里按选择器里的特征串分发，够跑通判断逻辑；
 * 选择器本身对不对是在真页面上用 tools/probe.mjs 验的，测试保不了那一层。
 */
function tweetPage(...specs) {
	const doc = fakeDoc();
	const articles = [];
	const build = (spec, parent) => {
		const node = { nodeName: 'ARTICLE', parentElement: parent, id: spec.id, quoted: null };
		const link = (href, label) => {
			const a = doc.adopt(el('a', { href }, [label]));
			a.closest = () => node;
			return a;
		};
		node.statusLink = link(`/u/status/${spec.id}`, spec.time ?? '');
		node.nameLink = link('https://x.com/u', spec.name ?? '');
		node.handleLink = link('https://x.com/u', `@${spec.id}`);
		node.body = doc.adopt(el('div', { dir: 'auto' }, [spec.text ?? '']));
		node.body.closest = () => node;
		node.closest = (selector) => (selector === 'article' ? node : null);
		if (spec.quotes) node.quoted = build({ id: spec.quotes }, node);

		const linksIn = (a) => [a.statusLink, ...(a.quoted ? linksIn(a.quoted) : [])];
		node.querySelectorAll = (selector) => {
			// 判断顺序有讲究：时间和昵称那两条选择器里都带着 /status/（一个是取它，
			// 一个是排除它），先判特征更强的
			if (selector.includes('time[datetime]')) return [node.statusLink];
			if (selector.includes('//x.com/')) return [node.nameLink, node.handleLink];
			if (selector.includes('/status/')) {
				const wanted = selector.match(/\/status\/(\d+)/)?.[1] ?? '';
				return linksIn(node).filter((l) => l.getAttribute('href').includes(`/status/${wanted}`));
			}
			if (selector.includes('dir="auto"')) return [node.body];
			return [];
		};
		articles.push(node);
		return node;
	};
	for (const spec of specs) build(spec, null);
	return Object.assign(doc, {
		querySelectorAll: (selector) => (selector === 'article' ? articles : []),
		// 只找页面上的顶层推文：引用推文是嵌在别人里面的另一个 article，id 会撞上
		byId: (id) => articles.find((a) => a.id === id && !a.parentElement),
	});
}

test('推文详情页上框出的是用户点开的那一条', () => {
	// 主推 + 两条回复：正文只要主推的，回复不进笔记
	const doc = tweetPage({ id: '111' }, { id: '222' }, { id: '333' });
	assert.equal(x.scope(doc, 'https://x.com/u/status/111'), doc.byId('111'));
	// 点开的是串里的第二条时，上文排在它前面，别框成上文
	assert.equal(x.scope(doc, 'https://x.com/u/status/222'), doc.byId('222'));
	// 配图页的 URL 多一段 /photo/1，推文 id 还是那个
	assert.equal(x.scope(doc, 'https://x.com/u/status/111/photo/1'), doc.byId('111'));
});

test('别人引用了主推时，不能把那条引用当成主推', () => {
	// 引用推文里也有一个指向主推的链接，按 closest 往上找会框到引用它的那条回复上
	const doc = tweetPage({ id: '999', quotes: '111' }, { id: '111' });
	assert.equal(x.scope(doc, 'https://x.com/u/status/111'), doc.byId('111'));
});

test('URL 里没有推文 id 就不框，退回整页', () => {
	const doc = tweetPage({ id: '111' });
	assert.equal(x.scope(doc, 'https://x.com/yyyole'), null);
	assert.equal(x.scope(doc, 'https://x.com/i/bookmarks'), null);
});

/** 回复拼出来的块，按 markdown 之前的文字看。 */
const replyText = (doc, url) => x.replies(doc, url).map((el) => el.textContent);

test('一条回复拼成「昵称(时间): 正文」一行', () => {
	// 整块收 article 的话昵称、@handle、时间、正文、阅读数各占一行，十几条读下来全是碎片
	const doc = tweetPage(
		{ id: '111', name: '沐阳', time: '8月23日', text: '主推' },
		{ id: '222', name: '沐阳', time: '8月23日', text: '地址在这里' },
		{ id: '333', name: 'Valir Masha', time: '8月24日', text: 'Open Source' },
	);
	assert.deepEqual(replyText(doc, 'https://x.com/u/status/111'), [
		// 分隔线后面报一下底下这串是什么，分隔线本身是引擎加的
		'comments:',
		'沐阳(8月23日): 地址在这里',
		'Valir Masha(8月24日): Open Source',
	]);
});

test('推特的回复只取主推底下的那些', () => {
	// 页面顺序：上文、主推、回复。主推之前的是上文，不是回复
	const doc = tweetPage(
		{ id: '111', name: 'A', time: 'Aug 23', text: '一' },
		{ id: '222', name: 'B', time: 'Aug 24', text: '二' },
		{ id: '333', name: 'C', time: 'Aug 24', text: '三' },
	);
	assert.deepEqual(replyText(doc, 'https://x.com/u/status/222'), ['comments:', 'C(Aug 24): 三']);
	// 一条回复都没有时连抬头都不要，免得笔记末尾挂一句空的 comments:
	assert.deepEqual(replyText(doc, 'https://x.com/u/status/333'), []);
	// 框不出主推就一条都不给，别把整页的推当成回复
	assert.deepEqual(replyText(doc, 'https://x.com/yyyole'), []);
});

test('推特的回复不越过对话容器', () => {
	// 回复列表底下还接着「更多推荐」那种不相干的推
	const doc = tweetPage(
		{ id: '111', name: 'A', time: 'Aug 23', text: '一' },
		{ id: '222', name: 'B', time: 'Aug 24', text: '二' },
		{ id: '333', name: 'C', time: 'Aug 24', text: '三' },
	);
	const conversation = { contains: (el) => el !== doc.byId('333') };
	for (const id of ['111', '222', '333']) {
		const article = doc.byId(id);
		article.closest = (selector) => (selector === 'article' ? article : conversation);
	}
	assert.deepEqual(replyText(doc, 'https://x.com/u/status/111'), ['comments:', 'B(Aug 24): 二']);
});

test('推特的引用推文不算回复', () => {
	// 引用推文是嵌在主推里的另一个 article，正文那条路已经收了
	const doc = tweetPage({ id: '111', name: 'A', time: 'Aug 23', text: '一', quotes: '999' });
	assert.deepEqual(replyText(doc, 'https://x.com/u/status/111'), []);
});

test('推特要按地址给图片去重', () => {
	// 视频封面在页面上有两份：占位 <img> 和 <video> 的 poster，两个选择器都留着
	assert.equal(x.dedupeImages, true);
});

test('回复和正文用的是同一份选择器，别各写一份', () => {
	// 回复就是另一条推，两边分头维护迟早对不上
	const root = x.root.join(' ');
	for (const selector of ['[data-testid="tweetText"]', 'div[dir="auto"]']) {
		assert.ok(root.includes(selector), `正文选择器 ${selector} 没出现在 root 里`);
	}
	assert.ok(x.keepLineBreaks.includes('div[dir="auto"]'), '推文的换行要转成 <br>');
	// 回复搬进合成行之后原来那个 div 就没了，按类名再点一次
	assert.ok(
		x.keepLineBreaks.some((s) => s.startsWith('.')),
		'合成的回复行里也要保住换行',
	);
});
