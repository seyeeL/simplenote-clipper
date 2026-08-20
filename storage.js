// chrome.storage.local 的薄封装。故意不放进 lib/：lib/ 里的模块是 web accessible
// 资源，会被网页 import；token 相关的读写不该出现在那个目录。

const AUTH_KEY = 'auth';
const SETTINGS_KEY = 'settings';
const IMAGE_REPORT_KEY = 'lastImageReport';

const DEFAULT_SETTINGS = {
	defaultTags: 'clip',
	pinned: false,
	// 第一行是否写成 "# 标题"。默认关闭：Simplenote 列表里直接显示第一行，
	// 带 # 会连井号一起显示。
	titleHeading: false,
	// 图床（阿里云 OSS）。默认关闭，不填就走原图链接。
	oss: {
		enabled: false,
		accessKeyId: '',
		accessKeySecret: '',
		bucket: '',
		region: 'oss-cn-beijing',
		path: 'clipper/',
		customDomain: '',
	},
};

/** @returns {Promise<{username: string, token: string} | null>} */
export async function loadAuth() {
	const stored = await chrome.storage.local.get(AUTH_KEY);
	const auth = stored[AUTH_KEY];
	if (!auth || typeof auth.token !== 'string' || !auth.token) return null;
	return { username: auth.username ?? '', token: auth.token };
}

export async function saveAuth(auth) {
	await chrome.storage.local.set({ [AUTH_KEY]: { username: auth.username ?? '', token: auth.token } });
}

export async function clearAuth() {
	await chrome.storage.local.remove(AUTH_KEY);
}

export async function loadSettings() {
	const stored = await chrome.storage.local.get(SETTINGS_KEY);
	const saved = stored[SETTINGS_KEY] ?? {};
	// oss 是嵌套对象，浅合并会让新增字段丢默认值
	return { ...DEFAULT_SETTINGS, ...saved, oss: { ...DEFAULT_SETTINGS.oss, ...(saved.oss ?? {}) } };
}

/** 最近一次剪藏的图床结果。popup 一关就没了，落盘一份让设置页能回看。 */
export async function loadImageReport() {
	const stored = await chrome.storage.local.get(IMAGE_REPORT_KEY);
	return stored[IMAGE_REPORT_KEY] ?? null;
}

export async function saveImageReport(report) {
	await chrome.storage.local.set({ [IMAGE_REPORT_KEY]: { ...report, at: new Date().toISOString() } });
}

export async function saveSettings(patch) {
	const current = await loadSettings();
	const next = { ...current, ...patch, oss: { ...current.oss, ...(patch.oss ?? {}) } };
	await chrome.storage.local.set({ [SETTINGS_KEY]: next });
	return next;
}
