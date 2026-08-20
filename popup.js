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

	$('clip').addEventListener('click', async () => {
		if (!tab?.id) {
			setStatus('读不到当前标签页。', 'err');
			return;
		}
		$('clip').disabled = true;
		setStatus('提取正文中…');

		const result = await chrome.runtime.sendMessage({
			type: 'clip',
			// 每次打开都是不勾的状态：跳过图片是「这一篇不要图」的临时决定，
			// 记住上次的选择反而会让人不知不觉丢掉后面几篇的配图
			payload: { tabId: tab.id, tags: $('tags').value, skipImages: $('skip-images').checked },
		});

		$('clip').disabled = false;
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
