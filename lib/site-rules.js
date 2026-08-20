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

/** /explore/<笔记 id> 里的那段 id。取不到返回空串。 */
function noteIdFromUrl(url) {
	try {
		return new URL(String(url)).pathname.split('/').filter(Boolean).pop() ?? '';
	} catch {
		return '';
	}
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
	{
		name: '小红书',
		hosts: ['xiaohongshu.com'],
		// 文字在前图片在后：一条笔记最多九张图，图排前面要翻很久才看得到文案。
		// 标题和时间各有自己的元素，不要整块 .note-content，否则时间会跟着进正文
		root: ['#detail-desc', '.media-container'],
		title: '#detail-title',
		// 页面上到处都是推荐笔记卡片，也用 .author-wrapper .name，必须限定在笔记容器里
		author: '#noteContainer .author-wrapper .name',
		// 页面上只有「6天前」这种相对时间。JSON-LD 里虽然有 datePublished，但那是
		// 页面渲染时间（实测就是当下这一秒），不是发布时间，不能用。真正的时间戳在
		// SSR 塞进 script 的 __INITIAL_STATE__ 里，从 noteDetailMap 那段往后找。
		publishedFrom: (doc, url) => {
			for (const script of doc.querySelectorAll('script')) {
				const text = script.textContent || '';
				if (!text.includes('__INITIAL_STATE__')) continue;
				// 从 noteDetailMap 那段往后找，退一步用 URL 里的笔记 id 定位。
				// 不从整段头上找：state 里还有推荐流，第一个 "time" 未必是这条笔记的
				const noteId = noteIdFromUrl(url);
				const anchors = ['"noteDetailMap"'];
				if (noteId) anchors.push(`"${noteId}"`);
				for (const anchor of anchors) {
					const at = text.indexOf(anchor);
					if (at < 0) continue;
					const match = text.slice(at).match(/"time"\s*:\s*(\d{13})/);
					if (match) return new Date(Number(match[1])).toISOString();
				}
			}
			return '';
		},
		// 兜底：state 结构变了至少还有页面上那个相对时间
		published: '.bottom-container .date',
		// 没有单独标题的笔记（正文首行就是标题）取正文开头当标题
		titleFromBody: true,
		// 「6天前 重庆」：末尾跟的是发布地点，不是时间的一部分。
		// 「昨天 22:03」这种末尾不是纯中文，不会被误切
		normalizePublished: (text) =>
			String(text)
				.replace(/^编辑于\s*/, '')
				.replace(/\s+[一-龥]+$/, '')
				.trim(),
		drop: [
			// swiper 循环滚动的复制品，同一张图会出现两次
			'.swiper-slide-duplicate',
			// 「1/9」页码、左右翻页箭头、长按保存提示
			'.fraction',
			'.arrow-controller',
			'#copy-img-guide',
			// 视频笔记：整个西瓜播放器，不删的话「00:00 倍速 2x 1.5x 请刷新试试」会进正文
			'.player-container',
			// 正文里的小红书表情是 <img>，开了图床会一张张传上去
			'img.note-content-emoji',
		],
		// 话题标签只要 #刘亦菲 这几个字，不要它指向站内搜索的链接
		unwrap: ['a.tag'],
		// 话题标签里夹着图标占位，页面上渲染成小图标，取文字就露出来了
		stripText: [/\[eoi\]/g],
		// 正文的分段是文本里的 \n 加 CSS white-space，HTML 里没有 <p> 也没有 <br>
		keepLineBreaks: ['#detail-desc'],
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
