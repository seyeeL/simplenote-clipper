// Simplenote 后端是 Simperium。两条链路：
//   1. 登录  app.simplenote.com  邮箱验证码换 sync_token
//   2. 写入  api.simperium.com   带 X-Simperium-Token 往 note bucket POST
// 端点和字段口径对齐 Automattic/simplenote-mcp（src/providers/auth.ts、simperium-api.ts）。

export const APP_ID = 'chalk-bump-f49';

const AUTH_BASE = 'https://app.simplenote.com';
const API_BASE = 'https://api.simperium.com/1';
// 官方客户端用 macOS / iOS。服务端按 request_source 给 token 划范围，
// 填自定义值能拿到 token，但 Simperium 会拒绝它。
const REQUEST_SOURCE = 'macOS';
const TIMEOUT_MS = 20_000;

export class SimperiumError extends Error {
	constructor(code, message, status) {
		super(message);
		this.name = 'SimperiumError';
		this.code = code;
		this.status = status;
	}
}

async function request(url, init) {
	try {
		return await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
	} catch (err) {
		const reason = err?.name === 'TimeoutError' ? '请求超时' : err?.message || String(err);
		throw new SimperiumError('network_error', `连不上 Simplenote：${reason}`);
	}
}

function postJson(url, body, headers = {}) {
	return request(url, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', ...headers },
		body: JSON.stringify(body),
	});
}

/** 登录响应字段是 snake_case，老版本可能给 token/syncToken，三种都认。 */
export function extractToken(body) {
	if (!body || typeof body !== 'object') return null;
	const candidate = body.sync_token ?? body.syncToken ?? body.token;
	return typeof candidate === 'string' && candidate.length > 0 ? candidate : null;
}

/** 第一步：让 Simplenote 往邮箱发验证码。 */
export async function requestLoginCode(email) {
	const res = await postJson(`${AUTH_BASE}/account/request-login`, {
		username: email,
		request_source: REQUEST_SOURCE,
	});
	if (res.status === 429) {
		throw new SimperiumError('rate_limited', '请求太频繁，等几分钟再试。', 429);
	}
	if (!res.ok) {
		throw new SimperiumError('request_failed', `发送验证码失败（HTTP ${res.status}）。`, res.status);
	}
}

/** 第二步：验证码换 token。 */
export async function completeLogin(email, authCode) {
	const res = await postJson(`${AUTH_BASE}/account/complete-login`, {
		username: email,
		auth_code: authCode,
	});
	if (res.status === 401 || res.status === 403) {
		throw new SimperiumError('invalid_code', '验证码不对或已过期，重新发一次。', res.status);
	}
	if (res.status === 429) {
		throw new SimperiumError('rate_limited', '尝试太频繁，等几分钟再试。', 429);
	}
	if (!res.ok) {
		throw new SimperiumError('request_failed', `登录失败（HTTP ${res.status}）。`, res.status);
	}

	let parsed;
	try {
		parsed = await res.json();
	} catch {
		throw new SimperiumError('invalid_response', '登录返回的不是合法 JSON。');
	}
	const token = extractToken(parsed);
	if (!token) {
		throw new SimperiumError('invalid_response', '登录返回里没有 token。');
	}
	return { username: parsed.username || email, token };
}

/**
 * 新建笔记。id 和 ccid 都是客户端生成的：id 是笔记主键，ccid 是幂等标记，
 * 网络抖动后重试同一个 ccid 不会写出两条。
 */
export async function createNote({ token, noteData, id = crypto.randomUUID(), ccid = crypto.randomUUID() }) {
	if (!token) throw new SimperiumError('no_token', '还没登录 Simplenote。');

	const url = `${API_BASE}/${APP_ID}/note/i/${encodeURIComponent(id)}?ccid=${encodeURIComponent(ccid)}`;
	const res = await request(url, {
		method: 'POST',
		headers: { 'X-Simperium-Token': token, 'Content-Type': 'application/json' },
		body: JSON.stringify(noteData),
	});

	if (res.status === 401 || res.status === 403) {
		throw new SimperiumError('unauthorized', 'Simplenote 登录已失效，去设置页重新登录。', res.status);
	}
	if (res.status === 429) {
		throw new SimperiumError('rate_limited', 'Simperium 限流了，稍后再剪。', 429);
	}
	if (!res.ok) {
		throw new SimperiumError('request_failed', `写入失败（HTTP ${res.status}）。`, res.status);
	}

	return { id, version: res.headers.get('X-Simperium-Version') };
}
