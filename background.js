// Service worker：串起「注入抓取 → 拼 markdown → POST Simperium」。
// 放在这里而不是 popup 里，是因为 popup 一关闭它的 fetch 就被掐断，
// 而剪藏经常要等几秒。

import {
	buildRefererRules,
	collectImageUrls,
	extensionFor,
	rewriteImageUrls,
	sha256Hex,
	stripImages,
} from './lib/images.js';
import { buildNoteContent, buildNoteData, buildTags } from './lib/note.js';
import { buildObjectKey, isOssConfigured, probeUpload, putObject } from './lib/oss.js';
import { ruleFor } from './lib/site-rules.js';
import { createNote, SimperiumError } from './lib/simperium.js';
import { loadAuth, loadSettings, saveImageReport } from './storage.js';

const MENU_ID = 'clip-to-simplenote';
const BADGE_MS = 4000;

// 单张图上限。超过基本是原图大图，转存意义不大，还拖慢剪藏
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
// 同时传几张。图多的文章别一次把带宽打满
const UPLOAD_CONCURRENCY = 4;
// 抓任意站点的图需要的权限，勾选启用图床时才向用户申请
const IMAGE_ORIGINS = { origins: ['<all_urls>'] };
// 失败详情留几条给设置页看。同一篇文章的失败原因通常一样，不用全存
const MAX_KEPT_ERRORS = 5;
// 补 Referer 用的会话规则从这个 id 开始。会话规则不落盘，浏览器一关就没了
const REFERER_RULE_ID = 1;

chrome.runtime.onInstalled.addListener(() => {
	chrome.contextMenus.create({
		id: MENU_ID,
		title: '剪藏到 Simplenote',
		contexts: ['page', 'selection', 'link'],
	});
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
	if (info.menuItemId !== MENU_ID || !tab?.id) return;
	const settings = await loadSettings();
	await clip({ tabId: tab.id, tags: settings.defaultTags });
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
	if (message?.type === 'clip') {
		clip(message.payload ?? {}).then(sendResponse);
		return true; // 异步回包
	}
	if (message?.type === 'probe-oss') {
		probeOss().then(sendResponse);
		return true;
	}
	return false;
});

/**
 * 图床自检。剪藏时逐张失败很难判断卡在哪一环，这里按顺序验三件事：
 * 有没有权限、配置全不全、OSS 收不收这次上传。
 */
export async function probeOss() {
	const { oss } = await loadSettings();
	if (!isOssConfigured(oss)) {
		return { ok: false, stage: 'config', message: 'AccessKey ID / Secret / Bucket / Region 没填全。' };
	}
	if (!(await chrome.permissions.contains(IMAGE_ORIGINS))) {
		return { ok: false, stage: 'permission', message: '缺少跨域读取权限，把「启用图床」取消再重新勾选，弹窗里点允许。' };
	}
	try {
		const { url } = await probeUpload(oss);
		return { ok: true, message: `上传成功：${url}` };
	} catch (err) {
		return {
			ok: false,
			stage: 'upload',
			message: `${err?.message ?? String(err)}${signatureVerdict(err)}`,
		};
	}
}

/**
 * SignatureDoesNotMatch 时 OSS 会回显它算出来的 StringToSign。
 * 和本地拼的一比就能分辨：一样 = 密钥填错了；不一样 = 签名格式有问题。
 * 少这一步就得靠猜，实测这正是最耗时间的地方。
 */
function signatureVerdict(err) {
	const remote = err?.detail?.stringToSign;
	const local = err?.detail?.localStringToSign;
	if (err?.code !== 'SignatureDoesNotMatch' || !remote || !local) return '';
	return remote === local
		? '\n\n签名格式没问题（OSS 算的 StringToSign 和本地完全一致），问题在 AccessKey Secret：' +
			'重新复制一遍，注意别多空格、别漏字符、别和别的密钥串行。'
		: `\n\n签名格式对不上，这是扩展的 bug。\nOSS 算的：${JSON.stringify(remote)}\n本地拼的：${JSON.stringify(local)}`;
}

async function flashBadge(ok) {
	await chrome.action.setBadgeBackgroundColor({ color: ok ? '#2E7D32' : '#C62828' });
	await chrome.action.setBadgeText({ text: ok ? '✓' : '!' });
	setTimeout(() => chrome.action.setBadgeText({ text: '' }), BADGE_MS);
}

/**
 * 在页面里跑提取。整个函数体会被序列化后注入，拿不到这里的作用域，
 * 所以 lib 的地址要通过 args 传进去，而且 DOM 节点不能跨边界返回 ——
 * markdown 必须在页面内就转好。
 */
async function collectArticle(tabId) {
	const libBase = chrome.runtime.getURL('lib/');
	const [injected] = await chrome.scripting.executeScript({
		target: { tabId },
		args: [libBase],
		func: async (base) => {
			const { extractArticle } = await import(`${base}extract.js`);
			const { htmlToMarkdown } = await import(`${base}html2md.js`);
			const article = extractArticle(document, location.href);
			return {
				url: article.url,
				title: article.title,
				author: article.author,
				publishedAt: article.publishedAt,
				siteName: article.siteName,
				markdown: htmlToMarkdown(article.root),
			};
		},
	});
	if (!injected?.result) throw new Error('页面没有返回内容。');
	return injected.result;
}

/** 抓一张图传到 OSS，返回新地址。 */
async function mirrorOne(url, oss) {
	// service worker 默认不发 Referer，微信这类防盗链站点反而能正常返回原图；
	// 带错 Referer 会拿到「未经允许不可引用」的占位图
	let res;
	try {
		res = await fetch(url);
	} catch (err) {
		// 没拿到跨域权限时图片站点不返回 CORS 头，这里就是一句没有信息量的
		// "Failed to fetch"，得自己补上下文
		throw new Error(`抓图失败：${err?.message ?? err}（可能是缺少跨域读取权限）`);
	}
	if (res.status === 403) {
		// 防盗链站点最常见的回法。站点规则里配 imageReferer 就能过
		throw new Error('抓图失败：HTTP 403（图片站点防盗链，拒绝这次转存）');
	}
	if (!res.ok) throw new Error(`抓图失败：HTTP ${res.status}`);

	const buffer = await res.arrayBuffer();
	if (!buffer.byteLength) throw new Error('抓图失败：空响应');
	if (buffer.byteLength > MAX_IMAGE_BYTES) throw new Error('跳过：超过大小上限');

	const contentType = res.headers.get('Content-Type') ?? '';
	const ext = extensionFor(contentType, url);
	const key = buildObjectKey({ prefix: oss.path, hash: await sha256Hex(buffer), ext });
	return putObject({
		config: oss,
		key,
		body: buffer,
		// 上游偶尔返回 application/octet-stream，按后缀回正，否则图床里点开会变成下载
		contentType: contentType.startsWith('image/') ? contentType.split(';')[0].trim() : `image/${ext}`,
	});
}

/**
 * 抓图期间临时给指定站点补上 Referer，抓完立刻撤掉。
 * 规则是会话级的，不落盘；用固定 id 覆盖式写入，上次剪藏崩在中途留下的残规则
 * 会被这次的 addRules 顶掉。
 */
async function withImageReferer(rule, fn) {
	const rules = buildRefererRules(rule, REFERER_RULE_ID);
	if (!rules.length) return fn();
	const removeRuleIds = rules.map((r) => r.id);
	await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds, addRules: rules });
	try {
		return await fn();
	} finally {
		await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds });
	}
}

/**
 * 把正文里的图片转存到图床。单张失败就保留原链接，不让整次剪藏失败 ——
 * 少一张图的笔记，比没有笔记有用。
 */
async function mirrorImages(markdown, oss, pageUrl) {
	const urls = collectImageUrls(markdown);
	if (!urls.length) return { markdown, uploaded: 0, failed: 0, errors: [] };

	// 没有跨域权限的话每张都会失败，而且报的是没信息量的 "Failed to fetch"。
	// 先查一次，直接说清楚，不要让人对着 N 条一样的错误猜。
	if (!(await chrome.permissions.contains(IMAGE_ORIGINS))) {
		return {
			markdown,
			uploaded: 0,
			failed: urls.length,
			errors: [{ url: '', reason: '缺少跨域读取权限：去设置页把「启用图床」取消再重新勾选，弹窗里点允许。' }],
		};
	}

	const mapping = {};
	const errors = [];
	await withImageReferer(ruleFor(pageUrl), async () => {
		for (let i = 0; i < urls.length; i += UPLOAD_CONCURRENCY) {
			await Promise.all(
				urls.slice(i, i + UPLOAD_CONCURRENCY).map(async (url) => {
					try {
						mapping[url] = await mirrorOne(url, oss);
					} catch (err) {
						const reason = err?.message ?? String(err);
						errors.push({ url, reason });
						console.warn('[图床] 转存失败，保留原链接:', url, reason);
					}
				}),
			);
		}
	});

	return {
		markdown: rewriteImageUrls(markdown, mapping),
		uploaded: Object.keys(mapping).length,
		failed: errors.length,
		errors,
	};
}

export async function clip({ tabId, tags, skipImages = false } = {}) {
	try {
		const auth = await loadAuth();
		if (!auth) {
			await flashBadge(false);
			return { ok: false, code: 'no_token', message: '还没登录 Simplenote，先去设置页登录。' };
		}

		const settings = await loadSettings();
		const article = await collectArticle(tabId);

		// 勾了「不保存图片」就在这里把图删干净，后面图床那一整段自然不用跑
		const stripped = skipImages
			? stripImages(article.markdown)
			: { markdown: article.markdown, removed: 0 };

		let images = { markdown: stripped.markdown, uploaded: 0, failed: 0, errors: [] };
		if (!skipImages && isOssConfigured(settings.oss)) {
			images = await mirrorImages(article.markdown, settings.oss, article.url);
			// popup 一关就没了，落盘一份让设置页能回看
			await saveImageReport({
				url: article.url,
				uploaded: images.uploaded,
				failed: images.failed,
				errors: images.errors.slice(0, MAX_KEPT_ERRORS),
			});
		}

		const content = buildNoteContent({
			...article,
			markdown: images.markdown,
			clippedAt: new Date(),
			titleHeading: settings.titleHeading,
		});
		const noteData = buildNoteData({
			content,
			// 来源站点不写进属性区；作者两边都有，标签那份看设置开关
			tags: buildTags({
				tags: tags ?? settings.defaultTags,
				author: article.author,
				url: article.url,
				withAuthor: settings.tagAuthor,
				withSite: settings.tagSite,
			}),
			pinned: settings.pinned,
		});
		const result = await createNote({ token: auth.token, noteData });

		await flashBadge(true);
		return {
			ok: true,
			id: result.id,
			title: content.split('\n', 1)[0],
			chars: content.length,
			tags: noteData.tags,
			images: {
				uploaded: images.uploaded,
				failed: images.failed,
				reason: images.errors?.[0]?.reason ?? '',
				// 跳过时不写图床报告：这次压根没走图床，覆盖掉上次的结果只会让人以为
				// 上次也没图
				stripped: stripped.removed,
			},
		};
	} catch (err) {
		await flashBadge(false);
		if (err instanceof SimperiumError) {
			return { ok: false, code: err.code, message: err.message };
		}
		// executeScript 在 chrome:// / 扩展商店 / PDF 阅读器等页面必然失败
		const message = String(err?.message ?? err);
		if (/cannot be scripted|Cannot access|chrome:\/\/|Extension manifest/i.test(message)) {
			return { ok: false, code: 'restricted_page', message: '当前页面不允许注入脚本，换个普通网页试试。' };
		}
		return { ok: false, code: 'unknown', message };
	}
}
