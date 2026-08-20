// chrome.storage.local 的薄封装。故意不放进 lib/：lib/ 里的模块是 web accessible
// 资源，会被网页 import；token 相关的读写不该出现在那个目录。

const AUTH_KEY = 'auth';
const SETTINGS_KEY = 'settings';

const DEFAULT_SETTINGS = {
	defaultTags: 'clip',
	pinned: false,
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
	return { ...DEFAULT_SETTINGS, ...(stored[SETTINGS_KEY] ?? {}) };
}

export async function saveSettings(patch) {
	const next = { ...(await loadSettings()), ...patch };
	await chrome.storage.local.set({ [SETTINGS_KEY]: next });
	return next;
}
