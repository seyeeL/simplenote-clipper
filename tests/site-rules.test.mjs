import test from 'node:test';
import assert from 'node:assert/strict';

import { SITE_RULES, ruleFor, upgradeSinaImage } from '../lib/site-rules.js';

const wx = SITE_RULES.find((r) => r.name === '微信公众号');
const weibo = SITE_RULES.find((r) => r.name === '微博');
const xhs = SITE_RULES.find((r) => r.name === '小红书');

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
