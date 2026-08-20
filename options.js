import { completeLogin, requestLoginCode } from './lib/simperium.js';
import { clearAuth, loadAuth, loadSettings, saveAuth, saveSettings } from './storage.js';

const $ = (id) => document.getElementById(id);

function setStatus(id, text, kind = '') {
	const el = $(id);
	el.textContent = text;
	el.className = `status ${kind}`.trim();
}

async function renderAuth() {
	const auth = await loadAuth();
	$('logged-in').classList.toggle('hidden', !auth);
	$('logged-out').classList.toggle('hidden', Boolean(auth));
	if (auth) $('username').textContent = auth.username || '(未知邮箱)';
}

async function renderSettings() {
	const settings = await loadSettings();
	$('default-tags').value = settings.defaultTags;
	$('pinned').checked = Boolean(settings.pinned);
}

$('send-code').addEventListener('click', async () => {
	const email = $('email').value.trim();
	if (!email) {
		setStatus('auth-status', '先填邮箱。', 'err');
		return;
	}
	$('send-code').disabled = true;
	setStatus('auth-status', '发送中…');
	try {
		await requestLoginCode(email);
		$('code-row').classList.remove('hidden');
		$('code').focus();
		setStatus('auth-status', `验证码已发到 ${email}，查收后填下面。`, 'ok');
	} catch (err) {
		setStatus('auth-status', err.message, 'err');
	} finally {
		$('send-code').disabled = false;
	}
});

$('login').addEventListener('click', async () => {
	const email = $('email').value.trim();
	const code = $('code').value.trim();
	if (!code) {
		setStatus('auth-status', '先填验证码。', 'err');
		return;
	}
	$('login').disabled = true;
	setStatus('auth-status', '登录中…');
	try {
		const auth = await completeLogin(email, code);
		await saveAuth(auth);
		$('code').value = '';
		$('code-row').classList.add('hidden');
		await renderAuth();
		setStatus('auth-status', '登录成功，可以开始剪藏了。', 'ok');
	} catch (err) {
		setStatus('auth-status', err.message, 'err');
	} finally {
		$('login').disabled = false;
	}
});

$('logout').addEventListener('click', async () => {
	await clearAuth();
	await renderAuth();
	setStatus('auth-status', '已退出，本机 token 已清除。', 'ok');
});

$('save-settings').addEventListener('click', async () => {
	await saveSettings({
		defaultTags: $('default-tags').value,
		pinned: $('pinned').checked,
	});
	setStatus('settings-status', '已保存。', 'ok');
});

await renderAuth();
await renderSettings();
