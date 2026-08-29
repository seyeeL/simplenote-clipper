import { ruleFor } from './lib/site-rules.js';
import { loadAuth, loadSettings } from './storage.js';

const $ = (id) => document.getElementById(id);

function setStatus(text, kind = '') {
	const el = $('status');
	el.textContent = text;
	el.className = `status ${kind}`.trim();
}

async function currentTab() {
	const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
	return tab ?? null;
}

/**
 * service worker 空闲会被 Chrome 回收，唤醒它和把消息投递进去之间有竞态：
 * 偶尔 sendMessage 会直接以「Could not establish connection」拒绝，消息根本没送到。
 * 不接住的话按钮永远停在 disabled、状态永远停在「提取正文中…」，看着就像点了没反应。
 */
async function sendClip(payload) {
	const message = { type: 'clip', payload };
	try {
		return await chrome.runtime.sendMessage(message);
	} catch (err) {
		// 只在「压根没送到」这一种错误上重发。别的错误说不定消息已经进去了，
		// 重发会存出两条一模一样的笔记
		if (!/Could not establish connection|Receiving end does not exist/i.test(String(err?.message ?? err))) throw err;
		return chrome.runtime.sendMessage(message);
	}
}

async function init() {
	const tab = await currentTab();
	$('page-title').textContent = tab?.title || tab?.url || '（读不到当前页）';

	const auth = await loadAuth();
	if (!auth) {
		$('login-hint').classList.remove('hidden');
		return;
	}

	const settings = await loadSettings();
	$('tags').value = settings.defaultTags;
	$('clip-form').classList.remove('hidden');

	// 「同时剪藏评论」只在收得了回复的站点上露面（现在只有推特），默认勾上：
	// 推特很多内容是一串，只剪第一条等于剪了半句话
	const withReplies = typeof ruleFor(tab?.url)?.replies === 'function';
	$('with-replies-row').classList.toggle('hidden', !withReplies);

	$('clip').addEventListener('click', async () => {
		if (!tab?.id) {
			setStatus('读不到当前标签页。', 'err');
			return;
		}
		$('clip').disabled = true;
		setStatus('提取正文中…');

		let result;
		try {
			result = await sendClip({
				// 这两个勾选框每次打开都是不勾的状态：跳过图片、移除格式都是「这一篇」
				// 的临时决定，记住上次的选择反而会让人不知不觉丢掉后面几篇的配图和版式
				tabId: tab.id,
				tags: $('tags').value,
				skipImages: $('skip-images').checked,
				plainText: $('plain-text').checked,
				withReplies: withReplies && $('with-replies').checked,
			});
		} catch (err) {
			setStatus(`联系不上后台：${err?.message ?? err}`, 'err');
			return;
		} finally {
			$('clip').disabled = false;
		}

		if (result?.ok) {
			const parts = [`已存入 Simplenote（${result.chars} 字符）`];
			if (result.images?.stripped) parts.push(`去掉 ${result.images.stripped} 张图`);
			if (result.images?.uploaded) parts.push(`图片转存 ${result.images.uploaded} 张`);
			if (result.images?.failed) {
				// 只说「N 张失败」等于什么都没说，把第一条原因带出来
				parts.push(`${result.images.failed} 张失败：${result.images.reason || '原因见设置页'}`);
			}
			if (result.tags?.length) parts.push(`标签 ${result.tags.join(' ')}`);
			setStatus(parts.join('　'), 'ok');
		} else {
			setStatus(result?.message ?? '剪藏失败。', 'err');
		}
	});
}

for (const id of ['open-options', 'open-options-inline']) {
	$(id)?.addEventListener('click', (event) => {
		event.preventDefault();
		chrome.runtime.openOptionsPage();
	});
}

init().catch((err) => setStatus(String(err?.message ?? err), 'err'));
