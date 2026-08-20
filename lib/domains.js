// 域名 → 标签映射。剪藏时按来源站点自动打一个标签。
//
// 维护方式：key 写可注册域名（不带 www），子域自动继承 —— zhuanlan.zhihu.com
// 会命中 zhihu.com。mp.weixin.qq.com 这种要单独列，因为 qq.com 下不同子域完全是
// 两回事。没命中的域名退回主机名本身（去掉 www.），不硬造中文名。

export const DOMAIN_TAGS = {
	'mp.weixin.qq.com': '公众号',
	'weibo.com': '微博',
	'weibo.cn': '微博',
	'xiaohongshu.com': '小红书',
	'xhslink.com': '小红书',
	'zhihu.com': '知乎',
	'bilibili.com': 'B站',
	'douban.com': '豆瓣',
	'jianshu.com': '简书',
	'juejin.cn': '掘金',
	'sspai.com': '少数派',
	'36kr.com': '36氪',
	'infoq.cn': 'InfoQ',
	'v2ex.com': 'V2EX',
	'csdn.net': 'CSDN',
	'cnblogs.com': '博客园',
	'segmentfault.com': 'SegmentFault',
	'toutiao.com': '今日头条',
	'douyin.com': '抖音',
	'x.com': '推特',
	'twitter.com': '推特',
	'github.com': 'GitHub',
	'medium.com': 'Medium',
	'substack.com': 'Substack',
	'reddit.com': 'Reddit',
	'news.ycombinator.com': 'HackerNews',
	'youtube.com': 'YouTube',
	'notion.so': 'Notion',
	'notion.site': 'Notion',
	'workflowy.com': 'Workflowy',
	'flomoapp.com': 'flomo',
};

/**
 * 取 URL 对应的来源标签。命中映射用映射值，否则用去掉 www. 的主机名。
 * @returns {string} 取不到就返回空串，调用方负责跳过
 */
export function domainTag(url) {
	let host;
	try {
		host = new URL(String(url)).hostname.toLowerCase();
	} catch {
		return '';
	}
	if (!host) return '';

	if (DOMAIN_TAGS[host]) return DOMAIN_TAGS[host];

	// 后缀匹配取最长的那条，这样加进来一条 qq.com 也抢不走 mp.weixin.qq.com，
	// 匹配结果不依赖 DOMAIN_TAGS 的书写顺序
	let matched = '';
	for (const domain of Object.keys(DOMAIN_TAGS)) {
		if (host.endsWith(`.${domain}`) && domain.length > matched.length) matched = domain;
	}
	if (matched) return DOMAIN_TAGS[matched];

	return host.replace(/^www\./, '');
}
