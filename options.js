import { completeLogin, requestLoginCode } from './lib/simperium.js';
import { createRequestGate } from './lib/throttle.js';
import { clearAuth, loadAuth, loadImageReport, loadSettings, saveAuth, saveSettings } from './storage.js';

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
	$('tag-author').checked = Boolean(settings.tagAuthor);
	$('tag-site').checked = Boolean(settings.tagSite);
	$('insert-at-cursor').checked = Boolean(settings.insertAtCursor);
}

// 单独一个开关，勾了就存 —— 不放进「剪藏默认值」那个保存按钮下面，
// 免得改了这里以为没生效
$('insert-at-cursor').addEventListener('change', async () => {
	const wanted = $('insert-at-cursor').checked;
	await saveSettings({ insertAtCursor: wanted });
	setStatus(
		'clipboard-status',
		wanted ? '已开启：上传后链接会插到光标处，同时仍然写回剪贴板。' : '已关闭：上传后只把链接写回剪贴板。',
		'ok',
	);
});

// 两次请求之间至少隔这么久。连点时多余的点击直接丢掉，不发请求。
const REQUEST_INTERVAL_MS = 3000;
const sendCodeGate = createRequestGate(REQUEST_INTERVAL_MS);
const loginGate = createRequestGate(REQUEST_INTERVAL_MS);

$('send-code').addEventListener('click', async () => {
	if (!sendCodeGate.tryAcquire()) {
		setStatus('auth-status', `别连点，${Math.ceil(sendCodeGate.waitMs() / 1000)} 秒后再试。`, 'err');
		return;
	}
	try {
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
	} finally {
		sendCodeGate.release();
	}
});

$('login').addEventListener('click', async () => {
	if (!loginGate.tryAcquire()) {
		setStatus('auth-status', `别连点，${Math.ceil(loginGate.waitMs() / 1000)} 秒后再试。`, 'err');
		return;
	}
	try {
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
	} finally {
		loginGate.release();
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

$('probe-oss').addEventListener('click', async () => {
	$('probe-oss').disabled = true;
	setStatus('oss-status', '正在传一张 1×1 测试图…');
	// 先把当前表单存下来，否则测的是上次保存的旧配置
	await saveSettings({ oss: { ...readOssFields(), enabled: $('oss-enabled').checked } });
	const result = await chrome.runtime.sendMessage({ type: 'probe-oss' });
	$('probe-oss').disabled = false;
	setStatus('oss-status', result?.message ?? '没有返回结果。', result?.ok ? 'ok' : 'err');
});

async function renderImageReport() {
	const report = await loadImageReport();
	$('oss-report').classList.toggle('hidden', !report);
	if (!report) return;
	const when = report.at ? new Date(report.at).toLocaleString() : '';
	$('oss-report-summary').textContent =
		`${when}　成功 ${report.uploaded} 张，失败 ${report.failed} 张${report.url ? `　${report.url}` : ''}`;
	$('oss-report-errors').textContent = report.errors?.length
		? report.errors.map((e) => (e.url ? `${e.url}\n  → ${e.reason}` : e.reason)).join('\n\n')
		: '（没有失败）';
}

$('save-settings').addEventListener('click', async () => {
	await saveSettings({
		defaultTags: $('default-tags').value,
		pinned: $('pinned').checked,
		titleHeading: $('title-heading').checked,
		tagAuthor: $('tag-author').checked,
		tagSite: $('tag-site').checked,
	});
	setStatus('settings-status', '已保存。', 'ok');
});

await renderAuth();
await renderSettings();
await renderOss();
await renderImageReport();
