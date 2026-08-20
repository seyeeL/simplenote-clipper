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
	$('title-heading').checked = Boolean(settings.titleHeading);
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

// 图床要抓任意站点的图再传 OSS，需要跨域读取权限。做成可选权限，
// 不开图床的人装完扩展不用授权全站访问。
const OSS_ORIGINS = { origins: ['<all_urls>'] };

const OSS_FIELDS = {
	accessKeyId: 'oss-key-id',
	accessKeySecret: 'oss-key-secret',
	bucket: 'oss-bucket',
	region: 'oss-region',
	path: 'oss-path',
	customDomain: 'oss-domain',
};

async function renderOss() {
	const { oss } = await loadSettings();
	$('oss-enabled').checked = Boolean(oss.enabled);
	for (const [key, id] of Object.entries(OSS_FIELDS)) $(id).value = oss[key] ?? '';
	$('oss-fields').classList.toggle('hidden', !oss.enabled);
}

function readOssFields() {
	const oss = {};
	for (const [key, id] of Object.entries(OSS_FIELDS)) oss[key] = $(id).value.trim();
	return oss;
}

$('oss-enabled').addEventListener('change', async () => {
	const wanted = $('oss-enabled').checked;
	if (wanted && !(await chrome.permissions.contains(OSS_ORIGINS))) {
		// 必须在用户点击这个手势里发起，异步等待之后再请求会被拒
		const granted = await chrome.permissions.request(OSS_ORIGINS);
		if (!granted) {
			$('oss-enabled').checked = false;
			setStatus('oss-status', '没拿到跨域读取权限，图床没法抓图，已保持关闭。', 'err');
			return;
		}
	}
	await saveSettings({ oss: { ...readOssFields(), enabled: wanted } });
	$('oss-fields').classList.toggle('hidden', !wanted);
	setStatus('oss-status', wanted ? '图床已启用，记得把下面几项填全。' : '图床已关闭，之后直接引用原图链接。', 'ok');
});

$('save-oss').addEventListener('click', async () => {
	const oss = readOssFields();
	const missing = ['accessKeyId', 'accessKeySecret', 'bucket', 'region'].filter((k) => !oss[k]);
	if (missing.length) {
		setStatus('oss-status', 'AccessKey ID / Secret / Bucket / Region 都要填。', 'err');
		return;
	}
	await saveSettings({ oss: { ...oss, enabled: $('oss-enabled').checked } });
	setStatus('oss-status', '已保存。', 'ok');
});

$('save-settings').addEventListener('click', async () => {
	await saveSettings({
		defaultTags: $('default-tags').value,
		pinned: $('pinned').checked,
		titleHeading: $('title-heading').checked,
	});
	setStatus('settings-status', '已保存。', 'ok');
});

await renderAuth();
await renderSettings();
await renderOss();
