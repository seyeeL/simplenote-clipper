import test from 'node:test';
import assert from 'node:assert/strict';

import {
	SITE_RULES,
	ruleFor,
	timeFromStatusId,
	upgradeSinaImage,
	upgradeTwimgImage,
} from '../lib/site-rules.js';
// 回复那一段的版式是最终落进笔记的样子，直接按 markdown 断言
import { htmlToMarkdown } from '../lib/html2md.js';
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
	// 老版 React 那套 cell 列表：spec 写了 cell 就给这条推配一个，写 gap 就插一个空 cell
	const cells = [];
	// 新版 SSR 的对话 li：同一个 li 里的几条是一串
	const groups = new Map();
	const build = (spec, parent) => {
		const node = { nodeName: 'ARTICLE', parentElement: parent, id: spec.id, quoted: null };
		const link = (href, label) => {
			const a = doc.adopt(el('a', { href }, [label]));
			a.closest = () => node;
			return a;
		};
		node.statusLink = link(`/${spec.handle ?? 'u'}/status/${spec.id}`, spec.time ?? '');
		node.nameLink = link('https://x.com/u', spec.name ?? '');
		node.handleLink = link('https://x.com/u', `@${spec.handle ?? spec.id}`);
		// 老版页面才有 <time datetime>，新版只能从推文 id 里算日期
		node.timeEl = spec.iso ? doc.adopt(el('time', { datetime: spec.iso }, [spec.time ?? ''])) : null;
		if (node.timeEl) node.timeEl.closest = () => node;
		node.body = doc.adopt(el('div', { dir: 'auto' }, [spec.text ?? '']));
		node.body.closest = () => node;
		if (spec.li && !groups.has(spec.li)) groups.set(spec.li, { nodeName: 'LI' });
		node.closest = (selector) => {
			if (selector === 'article') return node;
			if (selector === 'li') return groups.get(spec.li) ?? null;
			return null;
		};
		if (spec.cell) {
			cells.push({
				getAttribute: (key) => (key === 'data-testid' ? 'cellInnerDiv' : null),
				querySelector: (s) => (s === 'article' ? node : null),
				contains: (el) => el === node,
			});
		}
		if (spec.quotes) {
			node.quoted = build(
				typeof spec.quotes === 'object' ? spec.quotes : { id: spec.quotes },
				node,
			);
		}

		const linksIn = (a) => [a.statusLink, ...(a.quoted ? linksIn(a.quoted) : [])];
		node.querySelectorAll = (selector) => {
			// 判断顺序有讲究：时间和昵称那两条选择器里都带着 /status/（一个是取它，
			// 一个是排除它），先判特征更强的
			if (selector.includes('time[datetime]')) {
				return node.timeEl ? [node.timeEl, node.statusLink] : [node.statusLink];
			}
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
	for (const spec of specs) {
		// 两条串之间那个不含推文的 cell：老版页面靠它把一串和下一串分开
		if (spec.gap) {
			cells.push({
				getAttribute: (key) => (key === 'data-testid' ? 'cellInnerDiv' : null),
				querySelector: () => null,
				contains: () => false,
			});
		} else if (spec.boundary) {
			// 「更多推荐」那一段的抬头：cell 之后出现的 section / h2 就是对话的尽头
			cells.push({ getAttribute: () => null, closest: () => null, contains: () => false });
		} else {
			build(spec, null);
		}
	}
	return Object.assign(doc, {
		querySelectorAll: (selector) => {
			if (selector === 'article') return articles;
			if (selector.includes('cellInnerDiv')) return cells;
			return [];
		},
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

/** 回复那一段最后落到笔记里的样子。 */
const replyMd = (doc, url) => {
	const wrap = doc.createElement('div');
	for (const block of x.replies(doc, url)) wrap.appendChild(block);
	return htmlToMarkdown(wrap);
};

/** 带 > 前缀的抬头行：一眼看出有几条、谁在谁下面。 */
const replyLines = (doc, url) =>
	replyMd(doc, url)
		.split('\n')
		.filter((line) => line.includes('**'));

/**
 * 日期按本机时区算（和页面上显示的那个对得上），测试里不能写死一个字面量，
 * 否则换个时区跑就红。
 */
const localDay = (iso) => {
	const d = new Date(iso);
	const pad = (n) => String(n).padStart(2, '0');
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

test('一条回复套成一段引用，抬头是「昵称 @handle · 日期」', () => {
	// 整块收 article 的话昵称、@handle、时间、正文、阅读数各占一行，十几条读下来全是碎片。
	// 版式对齐 Obsidian 官方剪藏器（defuddle）：引用段 + 加粗抬头 + 日期链回原推
	const iso = '2026-08-23T04:00:00.000Z';
	const doc = tweetPage(
		{ id: '111', name: '沐阳', handle: 'muyang', iso, text: '主推' },
		{ id: '222', name: '沐阳', handle: 'muyang', iso, text: '地址在这里' },
		{ id: '333', name: 'Valir Masha', handle: 'valir', iso, text: 'Open Source' },
	);
	const day = localDay(iso);
	assert.equal(
		replyMd(doc, 'https://x.com/muyang/status/111'),
		[
			'## Comments',
			'',
			`> **沐阳 @muyang** · [${day}](https://x.com/muyang/status/222)  `,
			'> 地址在这里',
			'',
			`> **Valir Masha @valir** · [${day}](https://x.com/valir/status/333)  `,
			'> Open Source',
		].join('\n'),
	);
});

test('页面上没有 <time> 时，日期从推文 id 里算', () => {
	// 新版页面的时间戳只有「8月7日」，没有年份；再往前的显示成「8h」。推文 id 是
	// snowflake，高位就是发布时间，算出来和页面上显示的那天对得上
	assert.equal(timeFromStatusId('2085627066423406716'), Date.parse('2026-08-07T07:20:16.369Z'));
	assert.equal(timeFromStatusId('2002724036355240392'), Date.parse('2025-12-21T12:53:13.737Z'));
	// 不是推文 id 的（老页面的相对时间、空串）不能瞎算
	assert.equal(timeFromStatusId('8h'), 0);
	assert.equal(timeFromStatusId(''), 0);

	const doc = tweetPage(
		{ id: '111', name: 'A', handle: 'a', text: '主推' },
		{ id: '2085627066423406716', name: 'B', handle: 'b', time: '8月7日', text: '二' },
	);
	const day = localDay('2026-08-07T07:20:16.369Z');
	assert.deepEqual(replyLines(doc, 'https://x.com/a/status/111'), [
		`> **B @b** · [${day}](https://x.com/b/status/2085627066423406716)  `,
	]);
});

test('回复某条评论的那条，套进那条评论的引用段里', () => {
	// 新版页面：一串对话包在同一个 <li> 里，第一条是顶层评论，后面几条接着它
	const doc = tweetPage(
		{ id: '111', name: 'A', handle: 'a', text: '主推' },
		{ id: '222', name: 'B', handle: 'b', text: '二', li: 'g1' },
		{ id: '333', name: 'A', handle: 'a', text: '回二', li: 'g1' },
		{ id: '444', name: 'C', handle: 'c', text: '四', li: 'g2' },
	);
	assert.deepEqual(
		replyLines(doc, 'https://x.com/a/status/111').map((line) => line.replace(/ · .*$/, '')),
		['> **B @b**', '> > **A @a**', '> **C @c**'],
	);
});

test('老版页面的层级看 cell 挨不挨着', () => {
	// 老版 React：每条推一个 cellInnerDiv，同一串的几条连着排，串与串之间夹一个空 cell
	const doc = tweetPage(
		{ id: '111', name: 'A', handle: 'a', text: '主推', cell: true },
		{ gap: true },
		{ id: '222', name: 'B', handle: 'b', text: '二', cell: true },
		{ id: '333', name: 'A', handle: 'a', text: '回二', cell: true },
		{ gap: true },
		{ id: '444', name: 'C', handle: 'c', text: '四', cell: true },
	);
	assert.deepEqual(
		replyLines(doc, 'https://x.com/a/status/111').map((line) => line.replace(/ · .*$/, '')),
		['> **B @b**', '> > **A @a**', '> **C @c**'],
	);
});

test('作者自己接着发的那串按平级排，不往里嵌', () => {
	// 串在页面结构上是一条条首尾相接的回复，照结构算会一条比一条深一层：
	// 实测沐阳那条电商图的推有八条串，套到第八层根本没法读
	const doc = tweetPage(
		{ id: '111', name: '沐阳', handle: 'yyyole', text: '主推', li: 'g1' },
		{ id: '222', name: '沐阳', handle: 'yyyole', text: '00、LOGO 生成', li: 'g1' },
		{ id: '333', name: '沐阳', handle: 'yyyole', text: '02、产品场景', li: 'g1' },
		// 别人的评论一出现，串就结束了：作者后面回评论区的那条算普通回复，该嵌还是嵌
		{ id: '444', name: '路人', handle: 'passerby', text: '好用', li: 'g2' },
		{ id: '555', name: '沐阳', handle: 'yyyole', text: '谢谢', li: 'g2' },
	);
	assert.deepEqual(
		replyLines(doc, 'https://x.com/yyyole/status/111').map((line) => line.replace(/ · .*$/, '')),
		['> **沐阳 @yyyole**', '> **沐阳 @yyyole**', '> **路人 @passerby**', '> > **沐阳 @yyyole**'],
	);
});

test('推特的回复只取主推底下的那些', () => {
	// 页面顺序：上文、主推、回复。主推之前的是上文，不是回复
	const doc = tweetPage(
		{ id: '111', name: 'A', handle: 'a', text: '一' },
		{ id: '222', name: 'B', handle: 'b', text: '二' },
		{ id: '333', name: 'C', handle: 'c', text: '三' },
	);
	assert.deepEqual(
		replyLines(doc, 'https://x.com/b/status/222').map((line) => line.replace(/ · .*$/, '')),
		['> **C @c**'],
	);
	// 一条回复都没有时连抬头都不要，免得笔记末尾挂一个空的 ## Comments
	assert.equal(replyMd(doc, 'https://x.com/c/status/333'), '');
	// 框不出主推就一条都不给，别把整页的推当成回复
	assert.equal(replyMd(doc, 'https://x.com/yyyole'), '');
});

test('老版页面收到「更多推荐」为止', () => {
	// 回复列表底下接着的推荐推也是一排 cell，混进来就成了别人的评论
	const doc = tweetPage(
		{ id: '111', name: 'A', handle: 'a', text: '主推', cell: true },
		{ gap: true },
		{ id: '222', name: 'B', handle: 'b', text: '二', cell: true },
		{ boundary: true },
		{ id: '333', name: 'C', handle: 'c', text: '更多推荐里的推', cell: true },
	);
	assert.deepEqual(
		replyLines(doc, 'https://x.com/a/status/111').map((line) => line.replace(/ · .*$/, '')),
		['> **B @b**'],
	);
});

test('推特的回复不越过对话容器', () => {
	// 回复列表底下还接着「更多推荐」那种不相干的推
	const doc = tweetPage(
		{ id: '111', name: 'A', handle: 'a', text: '一' },
		{ id: '222', name: 'B', handle: 'b', text: '二' },
		{ id: '333', name: 'C', handle: 'c', text: '三' },
	);
	const conversation = { contains: (el) => el !== doc.byId('333') };
	for (const id of ['111', '222', '333']) {
		const article = doc.byId(id);
		article.closest = (selector) => (selector === 'article' ? article : conversation);
	}
	assert.deepEqual(
		replyLines(doc, 'https://x.com/a/status/111').map((line) => line.replace(/ · .*$/, '')),
		['> **B @b**'],
	);
});

test('引用推文重排成和评论一样的抬头', () => {
	// 整块收进来是一堆碎行：昵称、@handle、时间各占一行，正文再接在后面，
	// 和评论那边两种版式
	const doc = tweetPage({
		id: '111',
		name: '沐阳',
		handle: 'yyyole',
		text: '主推',
		quotes: {
			id: '2083808480146997250',
			name: '蜘蛛侠 | 1000X GEM',
			handle: 'zhizhuxia22',
			time: '8月2日',
			text: '整理了一份无需KYC的Visa卡清单',
		},
	});
	const wrap = doc.createElement('div');
	for (const part of x.formatQuote(doc, doc.byId('111').quoted)) wrap.appendChild(part);
	const day = localDay(new Date(timeFromStatusId('2083808480146997250')).toISOString());
	assert.equal(
		htmlToMarkdown(wrap),
		[
			`**蜘蛛侠 | 1000X GEM @zhizhuxia22** · [${day}](https://x.com/zhizhuxia22/status/2083808480146997250)  `,
			'整理了一份无需KYC的Visa卡清单',
		].join('\n'),
	);
});

test('推特的引用推文不算回复', () => {
	// 引用推文是嵌在主推里的另一个 article，正文那条路已经收了
	const doc = tweetPage({ id: '111', name: 'A', handle: 'a', text: '一', quotes: '999' });
	assert.equal(replyMd(doc, 'https://x.com/a/status/111'), '');
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
