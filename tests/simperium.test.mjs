import test from 'node:test';
import assert from 'node:assert/strict';

import {
	APP_ID,
	completeLogin,
	createNote,
	extractToken,
	requestLoginCode,
	SimperiumError,
} from '../lib/simperium.js';

/** 替换全局 fetch，返回记录下来的调用；跑完自动还原。 */
function stubFetch(t, handler) {
	const calls = [];
	const original = globalThis.fetch;
	globalThis.fetch = async (url, init) => {
		calls.push({ url: String(url), init });
		return handler(String(url), init, calls.length);
	};
	t.after(() => {
		globalThis.fetch = original;
	});
	return calls;
}

function jsonResponse(body, { status = 200, headers = {} } = {}) {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'Content-Type': 'application/json', ...headers },
	});
}

test('extractToken 认 sync_token / syncToken / token 三种写法', () => {
	assert.equal(extractToken({ sync_token: 'a' }), 'a');
	assert.equal(extractToken({ syncToken: 'b' }), 'b');
	assert.equal(extractToken({ token: 'c' }), 'c');
	assert.equal(extractToken({ token: '' }), null);
	assert.equal(extractToken(null), null);
	assert.equal(extractToken('x'), null);
});

test('requestLoginCode 打 app.simplenote.com 并带 request_source', async (t) => {
	const calls = stubFetch(t, () => new Response('', { status: 200 }));
	await requestLoginCode('me@example.com');

	assert.equal(calls[0].url, 'https://app.simplenote.com/account/request-login');
	const body = JSON.parse(calls[0].init.body);
	assert.equal(body.username, 'me@example.com');
	// 服务端按 request_source 给 token 划范围，自定义值拿到的 token 会被 Simperium 拒
	assert.equal(body.request_source, 'macOS');
});

test('429 映射成 rate_limited', async (t) => {
	stubFetch(t, () => new Response('', { status: 429 }));
	await assert.rejects(
		requestLoginCode('me@example.com'),
		(err) => err instanceof SimperiumError && err.code === 'rate_limited' && err.status === 429,
	);
});

test('completeLogin 用 sync_token，username 缺失时回落到邮箱', async (t) => {
	stubFetch(t, () => jsonResponse({ sync_token: 'tok-1' }));
	const auth = await completeLogin('me@example.com', '123456');
	assert.deepEqual(auth, { username: 'me@example.com', token: 'tok-1' });
});

test('验证码错误映射成 invalid_code', async (t) => {
	stubFetch(t, () => new Response('', { status: 401 }));
	await assert.rejects(
		completeLogin('me@example.com', 'bad'),
		(err) => err instanceof SimperiumError && err.code === 'invalid_code',
	);
});

test('登录返回里没有 token 时报 invalid_response', async (t) => {
	stubFetch(t, () => jsonResponse({ username: 'me@example.com' }));
	await assert.rejects(
		completeLogin('me@example.com', '123456'),
		(err) => err instanceof SimperiumError && err.code === 'invalid_response',
	);
});

test('createNote POST 到 note bucket，带 token 头和 ccid', async (t) => {
	const calls = stubFetch(t, () => new Response('', { status: 200, headers: { 'X-Simperium-Version': '1' } }));
	const result = await createNote({
		token: 'tok-1',
		noteData: { content: 'hello' },
		id: 'note-id',
		ccid: 'ccid-1',
	});

	assert.equal(calls[0].url, `https://api.simperium.com/1/${APP_ID}/note/i/note-id?ccid=ccid-1`);
	assert.equal(calls[0].init.headers['X-Simperium-Token'], 'tok-1');
	assert.equal(JSON.parse(calls[0].init.body).content, 'hello');
	assert.deepEqual(result, { id: 'note-id', version: '1' });
});

test('note id 里的斜杠被转义，POST 不会跑到别的 bucket', async (t) => {
	const calls = stubFetch(t, () => new Response('', { status: 200 }));
	await createNote({ token: 'tok', noteData: {}, id: '../tag/i/x', ccid: 'c' });
	assert.ok(calls[0].url.includes('note/i/..%2Ftag%2Fi%2Fx'));
});

test('未登录直接抛 no_token，不发请求', async (t) => {
	const calls = stubFetch(t, () => new Response('', { status: 200 }));
	await assert.rejects(
		createNote({ token: '', noteData: {} }),
		(err) => err instanceof SimperiumError && err.code === 'no_token',
	);
	assert.equal(calls.length, 0);
});

test('token 失效映射成 unauthorized，方便上层提示重新登录', async (t) => {
	stubFetch(t, () => new Response('', { status: 401 }));
	await assert.rejects(
		createNote({ token: 'stale', noteData: {} }),
		(err) => err instanceof SimperiumError && err.code === 'unauthorized',
	);
});

test('网络异常统一包成 network_error，不把原始异常直接抛给 UI', async (t) => {
	stubFetch(t, () => {
		throw new TypeError('Failed to fetch');
	});
	await assert.rejects(
		createNote({ token: 'tok', noteData: {} }),
		(err) => err instanceof SimperiumError && err.code === 'network_error',
	);
});
