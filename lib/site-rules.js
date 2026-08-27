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
// （转发微博的原文块套在外层内容块里，两块都收会把正文重复一遍）。同一页面上有几种
// 版式、选择器会互相嵌套时，用 :not(:has(…)) 把它们写成互斥的。
//
// keep 是通用噪声过滤的豁免名单：点名的块连同子树不再按 class / id 判噪声。短正文
// 顶着 share / footer 这类弱证据词时用得上。
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

/** 推特图片地址的 name 参数是尺寸档，页面上给的是 small / medium。 */
export function upgradeTwimgImage(src) {
	const raw = String(src ?? '').trim();
	let url;
	try {
		url = new URL(raw);
	} catch {
		return raw;
	}
	if (!/(^|\.)twimg\.com$/.test(url.hostname)) return raw;
	if (!url.searchParams.has('name')) return raw;
	// 只动 name，format 保持原样：webp 没有 orig 档（实测 404），large 两种格式都在
	url.searchParams.set('name', 'large');
	return url.toString();
}

/** /status/<推文 id> 里的那段 id。取不到返回空串。 */
function statusIdFromUrl(url) {
	try {
		const match = new URL(String(url)).pathname.match(/\/status(?:es)?\/(\d+)/);
		return match ? match[1] : '';
	} catch {
		return '';
	}
}

/**
 * 用户点开的那条推。
 *
 * 推文详情页上有一排同构的 `<article>`：上文、主推、回复各一个，引用推文还会再套一层
 * `<article>`。区分主推只有一个可靠特征——它的时间戳链接指向 URL 里的这个推文 id。
 *
 * 只认最外层 article 里「自己的」链接：引用了主推的那条回复，它的引用块里也有一个指向
 * 主推的链接，按 closest 找会框到回复上去。
 */
function focalTweet(doc, url) {
	const id = statusIdFromUrl(url);
	if (!id) return null;
	return (
		topLevelTweets(doc).find((article) =>
			Array.from(article.querySelectorAll(`a[href*="/status/${id}"]`)).some(
				(link) => link.closest('article') === article,
			),
		) ?? null
	);
}

/** 页面上的推，不含引用推文（那是嵌在别人里面的另一个 article）。 */
function topLevelTweets(doc) {
	return Array.from(doc.querySelectorAll('article')).filter(
		(el) => !el.parentElement?.closest?.('article'),
	);
}

// 一条推身上的东西：正文、配图、昵称、时间。两代前端的选择器排在一起，靠前的优先。
// 回复和主推是同一种结构，两边共用
const TWEET_TEXT = ['[data-testid="tweetText"]', 'div[dir="auto"]'];
const TWEET_MEDIA = [
	'img[src*="twimg.com/media/"]',
	'img[src*="_video_thumb/"]',
	'video[poster]',
];
const TWEET_NAME = [
	'[data-testid="User-Name"] a[role="link"]',
	'a[href*="//x.com/"]:not([href*="/status/"])',
	'a[href*="//twitter.com/"]:not([href*="/status/"])',
];
const TWEET_TIME = ['time[datetime]', 'a[href*="/status/"]:not([href*="/photo/"])'];
// 正文搬进合成的块之后，靠这个类名让换行还能转成 <br>（回复和引用推文都用它）
const TWEET_BODY_CLASS = 'x-tweet-body';
// 评论那一段的抬头，跟在分隔线后面
const REPLIES_HEADING = 'Comments';
// 推文 id 是 snowflake：高 41 位是这个纪元之后的毫秒数
const SNOWFLAKE_EPOCH = 1288834974657;

/** 主推那一块里用：排除引用推文（嵌在主推里的另一个 article）里的同名元素。 */
const inFocal = (selector) => `${selector}:not(article article *)`;
// 老版页面上 dir="auto" 满天飞（昵称、卡片标题都是），有 tweetText 就说明是老版，
// 新版那条正文选择器挂上这个就不生效，两条路互斥
const MODERN_ONLY = ':not(article:has([data-testid="tweetText"]) *)';

/** 这条推自己身上的元素，不含它引用的那条推里的。 */
function ownParts(article, selector) {
	return Array.from(article.querySelectorAll(selector)).filter(
		(el) => el.closest('article') === article,
	);
}

/** 按选择器优先级取第一个命中的（不是按文档顺序）。 */
function firstPart(article, selectors) {
	for (const selector of selectors) {
		const hit = ownParts(article, selector)[0];
		if (hit) return hit;
	}
	return null;
}

/**
 * 名字那一块里的链接（昵称、@handle）。正文里的 @某人 和外链挂的是同一种链接，
 * 拿它们当昵称会取到一串不相干的东西，所以把正文整块排掉。
 */
function nameLinks(article) {
	const body = firstPart(article, TWEET_TEXT);
	const links = [];
	for (const selector of TWEET_NAME) {
		for (const link of ownParts(article, selector)) {
			if (body?.contains?.(link)) continue;
			links.push(link);
		}
	}
	return links;
}

/** 昵称。@handle 和昵称挂的是同一种链接，@ 开头的那个是 handle，不要它。 */
function tweetAuthorName(article) {
	for (const link of nameLinks(article)) {
		const text = (link.textContent ?? '').replace(/\s+/g, ' ').trim();
		if (text && !text.startsWith('@')) return text;
	}
	return '';
}

/** 时间。老版有 <time datetime>，新版只有时间戳链接上那句「Aug 24」「8h」。 */
function tweetTime(article) {
	for (const el of ownParts(article, TWEET_TIME.join(','))) {
		const iso = el.getAttribute?.('datetime');
		if (iso) return iso.slice(0, 10);
		const text = (el.textContent ?? '').replace(/\s+/g, ' ').trim();
		if (text) return text;
	}
	return '';
}

/** @handle。昵称和 @handle 挂的是同一种链接，@ 开头的那个才是 handle。 */
function tweetHandle(article) {
	for (const link of nameLinks(article)) {
		const text = (link.textContent ?? '').replace(/\s+/g, ' ').trim();
		if (/^@\w{1,15}$/.test(text)) return text;
	}
	return '';
}

/** 推文 id 里带着发布时间（snowflake：高位是纪元之后的毫秒数）。认不出返回 0。 */
export function timeFromStatusId(id) {
	if (!/^\d+$/.test(String(id ?? ''))) return 0;
	try {
		return Number(BigInt(id) >> 22n) + SNOWFLAKE_EPOCH;
	} catch {
		return 0;
	}
}

/** 毫秒转 2026-08-07。按本机时区，和页面上显示的那个日期对得上。 */
function localDate(ms) {
	const date = new Date(ms);
	if (Number.isNaN(date.getTime())) return '';
	const pad = (n) => String(n).padStart(2, '0');
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * 一条推的发布日期和它自己的链接。
 *
 * 页面上给的时间不能直接用：新版只有「8月7日」这种没有年份的写法，一年后再看不知道
 * 是哪年的；再往前的还会显示成「8h」。推文 id 本身就是时间戳（snowflake），拿它算出
 * 的日期和页面上显示的那个一致（实测 2085627066423406716 → 2026-08-07，页面「8月7日」）。
 * 老版页面有 <time datetime> 就直接用它，省一次换算。
 *
 * 时间戳链接的 href 是站内相对地址（/handle/status/123），补成绝对地址才点得开。
 */
function tweetStamp(article, base) {
	const link = ownParts(article, TWEET_TIME[1])[0] ?? null;
	const href = link?.getAttribute?.('href') ?? '';
	let url = '';
	try {
		url = href ? new URL(href, base || 'https://x.com').toString() : '';
	} catch {
		url = '';
	}
	const iso = firstPart(article, [TWEET_TIME[0]])?.getAttribute?.('datetime') ?? '';
	const ms = iso ? Date.parse(iso) : timeFromStatusId(statusIdFromUrl(url));
	// 两条路都没算出日期时退回页面上那句原文（「8月7日」「8h」）
	return { date: (ms ? localDate(ms) : '') || tweetTime(article), url };
}

/**
 * 一条推拼成几个块：抬头一行「**昵称 @handle** · [日期](链接)」，下面是正文和配图。
 * 回复和引用推文都走这里，两处版式一致。
 *
 * 不整块收 article：那样昵称、@handle、时间、正文、阅读数各占一行，十几条回复读下来
 * 全是碎片。这里只挑昵称、handle、时间、正文、配图五样，其余（头像、阅读数、
 * 转推收藏那排按钮）一概不要。取不到正文也没有配图就返回 null，当这条推不存在。
 *
 * 正文搬的是子节点不是整块：正文在页面上是个 div，整块塞进来会自成一段，抬头那行就
 * 孤零零留在上面了。搬完挂上类名，后面 keepLineBreaks 才认得出这一块的换行要转成 <br>。
 */
function tweetParts(doc, article, base) {
	const body = firstPart(article, TWEET_TEXT);
	const media = ownParts(article, TWEET_MEDIA.join(','));
	if (!body && !media.length) return null;

	const parts = [];
	const meta = doc.createElement('p');
	const who = [tweetAuthorName(article), tweetHandle(article)].filter(Boolean).join(' ');
	const { date, url } = tweetStamp(article, base);
	if (who) {
		const strong = doc.createElement('strong');
		strong.appendChild(doc.createTextNode(who));
		meta.appendChild(strong);
	}
	if (date) {
		if (who) meta.appendChild(doc.createTextNode(' · '));
		if (url) {
			const link = doc.createElement('a');
			link.setAttribute('href', url);
			link.appendChild(doc.createTextNode(date));
			meta.appendChild(link);
		} else {
			meta.appendChild(doc.createTextNode(date));
		}
	}
	if (meta.childNodes.length) parts.push(meta);
	if (body) {
		const span = doc.createElement('span');
		span.setAttribute('class', TWEET_BODY_CLASS);
		for (const node of Array.from(body.childNodes)) span.appendChild(node.cloneNode(true));
		// 正文接在抬头那行下面，中间只换一行：另起一段的话引用段里会多出一行空的 >
		if (parts.length) {
			meta.appendChild(doc.createElement('br'));
			meta.appendChild(span);
		} else {
			const para = doc.createElement('p');
			para.appendChild(span);
			parts.push(para);
		}
	}
	// 配图各自成段：直接塞进去会和正文接成一行
	for (const el of media) {
		const para = doc.createElement('p');
		para.appendChild(el.cloneNode(true));
		parts.push(para);
	}
	return parts;
}

/** 一条回复套成一段引用。 */
function commentBlock(doc, article, base) {
	const parts = tweetParts(doc, article, base);
	if (!parts) return null;
	const quote = doc.createElement('blockquote');
	for (const part of parts) quote.appendChild(part);
	return quote;
}

/**
 * 主推引用的那条推。整块收进来的话昵称、@handle、时间各占一行，正文还接在后面，
 * 和回复那边是两种版式；拼成一样的「抬头 + 正文 + 配图」，两处读起来才一致。
 *
 * 引擎在克隆体上调它，那会儿页面上的地址已经不在手边了，所以 base 传 x.com：
 * 引用推文的时间戳链接是站内相对地址（twitter.com 上剪的也照样能点开）。
 */
function formatQuotedTweet(doc, article) {
	return tweetParts(doc, article, 'https://x.com');
}

/**
 * 老版 React 前端的对话列表：一条推一个 `[data-testid="cellInnerDiv"]`，按文档顺序排。
 *
 * 到「更多推荐 / Discover more」为止 —— 那底下也是一排 cell，混进来会被当成评论收走。
 * 边界是 cell 之后出现的 `section` / `h2`：推文自己里面的标题不算（那是这条推的一部分），
 * 第一个 cell 之前的也不算（页面顶上的「Post」标题和包着整个对话的 section 排在前面，
 * 拿它当边界会一条都收不到）。判法照搬 defuddle 的 twitter 提取器。
 *
 * 新版 SSR 前端没有这套 cell，返回空数组，层级和边界都走 li 那条路。
 */
function conversationCells(doc) {
	const cells = [];
	for (const el of Array.from(
		doc.querySelectorAll?.('[data-testid="cellInnerDiv"], section, h2') ?? [],
	)) {
		if (el.getAttribute?.('data-testid') === 'cellInnerDiv') cells.push(el);
		else if (cells.length && !el.closest?.('article')) break;
	}
	return cells;
}

/**
 * 页面结构给出的层级：0 是直接回复主推，1 是回复某条评论，往下依此类推。
 *
 * 两代前端各有各的表示法：
 *
 * - 新版（SSR）：一串对话包在同一个 `<li>` 里，li 里的第一条是顶层评论，后面几条是
 *   接着它的回复。未登录页面实测每个 li 只有一条，出来就是一串平铺的评论。
 * - 老版（React）：每条推各占一个 `[data-testid="cellInnerDiv"]`，同一串的几条挨着排，
 *   串与串之间夹一个不含推文的 cell。连着的 cell 逐级加深，遇到不含推文的 cell 归零
 *   —— 和 Obsidian 官方剪藏器（defuddle 的 twitter 提取器）的判法一致。
 */
function structuralDepths(doc, articles) {
	const cells = conversationCells(doc);
	if (cells.length) {
		const depths = new Map();
		let depth = 0;
		let lastWasTweet = false;
		for (const cell of cells) {
			const article = cell.querySelector?.('article');
			if (!article) {
				lastWasTweet = false;
				continue;
			}
			depth = lastWasTweet ? depth + 1 : 0;
			depths.set(article, depth);
			lastWasTweet = true;
		}
		return articles.map((article) => depths.get(article) ?? 0);
	}
	const seen = new Map();
	return articles.map((article) => {
		const cell = article.closest?.('li') ?? null;
		if (!cell) return 0;
		const n = seen.get(cell) ?? 0;
		seen.set(cell, n + 1);
		return n;
	});
}

/**
 * 每条回复的层级，作者自己那串单独算。
 *
 * 主推底下先是作者接着自己发的几条（串），再是别人的评论。串在页面结构上是一条条
 * 首尾相接的回复，照 structuralDepths 算会一条比一条深一层 —— 实测八条的串套到第八层
 * （沐阳那条电商图的推），根本没法读。串本来就是正文的续集，一律按平级排。
 *
 * 串到第一条别人的评论为止（和 defuddle 的判法一致）：作者后面回自己评论区的那条，
 * 算普通回复，该嵌进去还是要嵌。
 */
function replyDepths(doc, focal, articles) {
	const structural = structuralDepths(doc, articles);
	const mainHandle = tweetHandle(focal);
	let threadEnded = false;
	return articles.map((article, index) => {
		if (!threadEnded && mainHandle) {
			if (tweetHandle(article) === mainHandle) return 0;
			threadEnded = true;
		}
		return structural[index];
	});
}

/**
 * 一串回复按层级套成嵌套的引用段：回复某条评论的那条，套进那条评论的引用段里。
 *
 * 层级跳级时（上一条报 0、这一条报 2）按能挂上的最深那层挂，不凭空造中间层；
 * 第一条就报了非 0 也照样当顶层，页面结构变了不至于整段悬空。
 */
function commentTree(doc, articles, depths, base) {
	const roots = [];
	const stack = [];
	articles.forEach((article, index) => {
		const block = commentBlock(doc, article, base);
		if (!block) return;
		const level = Math.min(Math.max(depths[index] ?? 0, 0), stack.length);
		if (level === 0) roots.push(block);
		else stack[level - 1].appendChild(block);
		stack.length = level;
		stack.push(block);
	});
	return roots;
}

/**
 * 主推底下的回复。串（作者自己接着发的几条）和别人的评论都在这里，页面上排在主推
 * 后面 —— 主推之前的是上文，不算回复。
 *
 * 限定在这条对话里：回复列表底下还接着「更多推荐」那种不相干的推，收进来就成了
 * 别人的评论。老版 React 按 cell 边界切（见 conversationCells），新版 SSR 按对话容器切。
 *
 * 只拿得到当前 DOM 里的那些：X 的回复列表是滚动加载的，没往下翻就只有头几条。
 */
function tweetReplies(doc, url) {
	const focal = focalTweet(doc, url);
	if (!focal) return [];
	const tweets = topLevelTweets(doc);
	const at = tweets.indexOf(focal);
	if (at < 0) return [];
	// 老版 React 走 cell 边界，新版 SSR 走对话容器。都认不出来就不限定，
	// 宁可多收也别一条不收
	const cells = conversationCells(doc);
	const conversation = cells.length
		? null
		: (focal.closest?.('[id^="urt:conversation"]') ?? focal.closest?.('ul') ?? null);
	const replies = tweets
		.slice(at + 1)
		.filter((el) =>
			cells.length
				? cells.some((cell) => cell.contains?.(el))
				: !conversation || conversation.contains?.(el),
		);
	const blocks = commentTree(doc, replies, replyDepths(doc, focal, replies), url);
	if (!blocks.length) return [];

	// 分隔线（引擎自动加的）后面再报一下这是什么：底下这串是评论，不是正文的一部分
	const heading = doc.createElement('h2');
	heading.appendChild(doc.createTextNode(REPLIES_HEADING));
	return [heading, ...blocks];
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
		// 贴图型（图片消息）和普通图文是两套 DOM。贴图页的文案只有 #js_image_desc 一段，
		// 图片在页面顶部的 swiper 里，两块都不在一个共同的正文容器下；#js_content 在这种
		// 页面上装的是赞赏面板那一堆，整块收进来正文会变成「微信扫一扫赞赏作者」。
		// 所以贴图页按块取，普通图文仍旧走 #js_content —— :not(:has()) 让两条路互斥，
		// 同一页不会两边都命中（都命中的话嵌套去重只会留下 #js_content，文案就丢了）。
		// 文字排在图片前面：贴图最多二十张，图放前面要翻很久才看得到文案。
		// swiper 只认 #page_top_area 下的那份：顶上还有个 aria-hidden 的占位 swiper，
		// 里面是同一张首图，不限定范围首图会重复一遍。
		root: [
			'#js_image_desc',
			'#page_top_area .swiper_item_img',
			'#js_content:not(:has(#js_image_content))',
		],
		// 文案挂在 p.share_notice 上：命中弱证据词 share，一两句话又够不着 200 字的
		// 保命线，不点名保护就会被按类名整块删掉
		keep: ['#js_image_desc'],
		// 分享型页面（贴图、纯文字）没有 #js_name，公众号名只在关注条上；这两种页面的
		// meta author 还经常是空串，兜不住。普通图文两个元素都有，#js_name 在前面，
		// 取到的是同一个名字
		author: '#js_name, #js_wx_follow_nickname',
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
	{
		name: 'X（推特）',
		hosts: ['x.com', 'twitter.com'],
		// 详情页上主推、上文、回复是一排同构的 article，先框出主推那一个
		scope: focalTweet,
		// 勾了「连回复一起剪」时补在正文后面：推特很多内容是一串，光有第一条不完整
		replies: tweetReplies,
		// 主推这块里只挑三样东西：正文、配图、引用推文。头像、时间戳行、
		// 转推收藏计数、Views 都在 article 里，不点名就会跟着进正文。
		//
		// 两代前端的正文选择器都写上：新版（2026 年这套 Tailwind 页面）正文是
		// div[dir="auto"]，老版 React 页面是 data-testid="tweetText"。两条路要互斥
		// —— 老版页面上 dir="auto" 满天飞（昵称、卡片标题都有），一起收会带进一堆
		// 噪声，所以新版那条加了 :not(article:has([data-testid="tweetText"]) *)：
		// 页面上有 tweetText 就说明是老版，这条不生效。
		//
		// :not(article article *) = 不要引用推文里的东西。引用推文自己是嵌套的
		// article，整块单独收（放在最后，跟在页面顺序上一样排正文和配图后面），
		// 不然它的正文会和主推的混成一段。
		root: [
			inFocal(TWEET_TEXT[0]),
			inFocal(`${TWEET_TEXT[1]}${MODERN_ONLY}`),
			...TWEET_MEDIA.map(inFocal),
			'article article',
		],
		// 新版把名字挂在指向个人页的绝对链接上（头像那个链接是相对的 /yyyole，
		// 不会被误取）；老版是 data-testid。都限定在引用推文之外
		author: TWEET_NAME.map(inFocal).join(','),
		// 时间戳链接指向推文自己。排除 /photo/ 是因为配图上盖着的那个链接排在前面，
		// 但它没有文字
		published: TWEET_TIME.map(inFocal).join(','),
		// 「23:51 · 2026年8月23日」「11:51 PM · Aug 23, 2026」：中间点前面是时分，
		// 切掉之后中英文两种写法 toDateString 都吃得下。ISO 串里没有中间点，原样通过
		normalizePublished: (text) => String(text).split('·').pop().trim(),
		// 推文没有标题，取正文开头，再包成 X 自己那套页面标题的格式
		// （「沐阳 on X: 发现一个很酷的动效库…」）：笔记列表里一眼看出这是谁的哪条推。
		// 取不到作者名就只留正文，不留「 on X: 」这种半截前缀
		titleFromBody: true,
		titleFormat: ({ body, author }) => (author ? `${author} on X: ${body}` : body),
		// 视频存不进笔记，留封面图
		videoPoster: true,
		// 页面上给的是 small / medium 缩略图
		rewriteImageSrc: upgradeTwimgImage,
		// 视频封面在页面上有两份：底下垫着的占位 <img> 和 hydrate 之后 <video> 的 poster。
		// 两个选择器都得留着（谁先出现不一定），所以最后按地址去一次重
		dedupeImages: true,
		drop: [
			// 引用推文里的头像
			'img[src*="profile_images"]',
			// 表情是 <img>，开了图床会一张张传上去
			'img[src*="/emoji/"]',
		],
		// 引用推文划成引用段，不然它的正文接在主推后面，读起来像同一个人说的。
		// 选择器写 article 不写 article article：收进正文的只有引用推那一个 article，
		// 主推的 article 本身没被 root 收进来
		blockquote: ['article'],
		// 套引用段之前先重排一遍，版式和评论那边对齐
		formatQuote: formatQuotedTweet,
		// @某人 和 #话题 指向站内相对地址，转成 markdown 是一串点不开的链接。
		// 引用推文头上的昵称和 @handle 指向个人页，一样脱成文字。正文里的外链和
		// 指向别的推文的链接（带 /status/）都留着
		unwrap: [
			'a[href^="/"]',
			'a[href*="//x.com/"]:not([href*="/status/"])',
			'a[href*="//twitter.com/"]:not([href*="/status/"])',
		],
		// 推文的分段是文本里的 \n 加 CSS white-space，HTML 里没有 <p> 也没有 <br>
		// 回复搬进合成行之后原来那个 div 就没了，按类名再点一次
		keepLineBreaks: [...TWEET_TEXT, `.${TWEET_BODY_CLASS}`],
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
