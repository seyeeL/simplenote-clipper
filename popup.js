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
			payload: { tabId: tab.id, tags: $('tags').value },
		});

		$('clip').disabled = false;
		if (result?.ok) {
			const tags = result.tags?.length ? `　标签 ${result.tags.join(' ')}` : '';
			setStatus(`已存入 Simplenote（${result.chars} 字符）${tags}`, 'ok');
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
