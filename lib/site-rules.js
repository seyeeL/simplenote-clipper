// 站点专用提取规则。
//
// 通用启发式（按段落文字量和链接密度打分）对付不了两类站点：正文里一个 <p>
// 都没有的，和类名带构建 hash 的 SPA。给这些站点直接写明「正文在哪」。
//
// 命中的规则优先于通用逻辑；规则里没写的字段仍然走通用逻辑，不用一次写全。
// 类名带 hash 后缀时（微博的 _wbtext_1h76l_19）只匹配稳定的那一段，
// 否则微博一发版就失效。
//
// 加新站点看 docs/sites.md。

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
		root: '[class*="wbtext"]',
		author: 'a[class*="_name_"][href*="/u/"]',
		published: 'a[class*="_time_"]',
		// 微博没有标题这个概念，拿正文开头当标题
		titleFromBody: true,
		// 时间是两位年份：24-12-20 12:17
		normalizePublished: (text) => text.replace(/^(\d{2})-(\d{2})-(\d{2})\b/, '20$1-$2-$3'),
		// 表情是 <img>，混进正文会被当成图片，开了图床还会一张张传上去
		drop: ['img[src*="face.t.sinajs.cn"]', 'img[src*="/expression/"]'],
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
