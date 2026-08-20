// 站点专用提取规则。
//
// 通用启发式（按段落文字量和链接密度打分）对付不了两类站点：正文里一个 <p>
// 都没有的，和类名带构建 hash 的 SPA。给这些站点直接写明「正文在哪」。
//
// 命中的规则优先于通用逻辑；规则里没写的字段仍然走通用逻辑，不用一次写全。
// 类名带 hash 后缀时（微博的 _wbtext_1h76l_19）只匹配稳定的那一段，
// 否则微博一发版就失效。
//
// root 传一组选择器时是「并集」：命中的块按顺序拼成一个容器。互相嵌套的只留最外层
// （转发微博的原文块套在外层内容块里，两块都收会把正文重复一遍）。
//
// 加新站点看 docs/sites.md。

// 微博图片地址的第一段是尺寸，九宫格给的是缩略图。屏幕截图缩到 360 宽根本看不清，
// 换成 large 就是原图。只认下面这些尺寸段，头像的 crop.0.0.1080.1080.180 不在其中，
// 不会被误改。
const SINA_THUMB_SIZE = /^(thumbnail|thumb150|thumb300|square|bmiddle|orj360|orj480|mw690|mw1024|mw2000)$/;

/** 微博缩略图换成原图。不是微博图片、认不出尺寸段的原样返回。 */
export function upgradeSinaImage(src) {
	const raw = String(src ?? '').trim();
	let url;
	try {
		url = new URL(raw);
	} catch {
		return raw;
	}
	if (!/(^|\.)sinaimg\.cn$/.test(url.hostname)) return raw;
	const parts = url.pathname.split('/');
	// ['', 尺寸段, 文件名]；文件名为空说明不是张图，别改
	if (parts.length < 3 || !SINA_THUMB_SIZE.test(parts[1]) || !parts[parts.length - 1]) return raw;
	parts[1] = 'large';
	url.pathname = parts.join('/');
	return url.toString();
}

export const SITE_RULES = [
	{
		name: '微信公众号',
		hosts: ['mp.weixin.qq.com'],
		root: '#js_content',
		author: '#js_name',
		published: '#publish_time',
	},
	{
		name: '微博',
		hosts: ['weibo.com', 'weibo.cn'],
		// 正文和九宫格配图是页面上分开的两块，共同的外层是 wbpro-feed-content —— 这个
		// 类名不带构建 hash。wbtext 留着兜底：外层改名了至少正文还在。
		root: ['.wbpro-feed-content', '[class*="wbtext"]'],
		author: 'a[class*="_name_"][href*="/u/"]',
		published: 'a[class*="_time_"]',
		// 微博没有标题这个概念，拿正文开头当标题
		titleFromBody: true,
		// 时间是两位年份，月日还不补零：26-8-13 12:19 / 24-12-20 12:17
		normalizePublished: (text) =>
			String(text).replace(
				/^(\d{2})-(\d{1,2})-(\d{1,2})\b/,
				(_, y, m, d) => `20${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`,
			),
		// 表情是 <img>，混进正文会被当成图片，开了图床还会一张张传上去
		drop: ['img[src*="face.t.sinajs.cn"]', 'img[src*="/expression/"]'],
		// 九宫格给的是 orj360 缩略图，存下来的截图会糊
		rewriteImageSrc: upgradeSinaImage,
		// sinaimg 的防盗链看的是「浏览器 UA + 没有 Referer」这个组合：curl 裸请求 200，
		// 换成 Chrome UA 立刻 403，补上 weibo 的 Referer 又回到 200，跟图片尺寸无关。
		// service worker 抓图正好踩中，得把 Referer 补回去。
		imageReferer: 'https://weibo.com/',
		imageHosts: ['sinaimg.cn'],
	},
];

/** 命中的规则，没有就返回 null。子域自动继承（m.weibo.cn 命中 weibo.cn）。 */
export function ruleFor(url) {
	let host;
	try {
		host = new URL(String(url)).hostname.toLowerCase();
	} catch {
		return null;
	}
	if (!host) return null;
	return (
		SITE_RULES.find((rule) =>
			rule.hosts.some((h) => host === h || host.endsWith(`.${h}`)),
		) ?? null
	);
}
