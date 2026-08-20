// Service worker：串起「注入抓取 → 拼 markdown → POST Simperium」。
// 放在这里而不是 popup 里，是因为 popup 一关闭它的 fetch 就被掐断，
// 而剪藏经常要等几秒。

import { buildNoteContent, buildNoteData, buildTags } from './lib/note.js';
import { createNote, SimperiumError } from './lib/simperium.js';
import { loadAuth, loadSettings } from './storage.js';

const MENU_ID = 'clip-to-simplenote';
const BADGE_MS = 4000;

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
	if (message?.type !== 'clip') return false;
	clip(message.payload ?? {}).then(sendResponse);
	return true; // 异步回包
});

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

export async function clip({ tabId, tags } = {}) {
	try {
		const auth = await loadAuth();
		if (!auth) {
			await flashBadge(false);
			return { ok: false, code: 'no_token', message: '还没登录 Simplenote，先去设置页登录。' };
		}

		const settings = await loadSettings();
		const article = await collectArticle(tabId);

		const content = buildNoteContent({
			...article,
			clippedAt: new Date(),
			titleHeading: settings.titleHeading,
		});
		const noteData = buildNoteData({
			content,
			// 作者和来源站点不写进 frontmatter，走标签
			tags: buildTags({
				tags: tags ?? settings.defaultTags,
				author: article.author,
				url: article.url,
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
