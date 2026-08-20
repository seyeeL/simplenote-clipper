import test from 'node:test';
import assert from 'node:assert/strict';

import { SITE_RULES, ruleFor, upgradeSinaImage } from '../lib/site-rules.js';

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
