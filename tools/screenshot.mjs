// 给设置页或 popup 拍一张 README 用的截图。UI 改了就重跑一次，别让 README 里的图烂掉：
//
//   node tools/screenshot.mjs [输出路径]            设置页
//   node tools/screenshot.mjs --popup [输出路径]    popup
//
// 不加载真扩展：那样要先拿 extension id，而且会读到本机真实配置（含密钥）。
// 改成起一个本地 http 服务（ES module 走 file:// 会被 CORS 挡），
// 在 options.js 之前注入一份 chrome API 桩，喂进去全是假数据。
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = dirname(dirname(fileURLToPath(import.meta.url)));
const PORT = 8731;
const CDP_PORT = 9345;
const POPUP = process.argv.includes('--popup');
const PAGE = POPUP ? 'popup' : 'options';
const OUT =
	process.argv.slice(2).find((a) => !a.startsWith('--')) ??
	join(REPO, POPUP ? 'docs/popup.png' : 'docs/options.png');

// 全是假的：真密钥不能出现在截图里
const DEMO = {
	auth: { username: 'you@example.com', token: 'demo' },
	settings: {
		defaultTags: 'clip 剪藏',
		pinned: false,
		titleHeading: false,
		oss: {
			enabled: true,
			accessKeyId: 'LTAI5tExampleAccessKeyId',
			accessKeySecret: 'example-secret',
			bucket: 'my-bucket',
			region: 'oss-cn-beijing',
			path: 'clipper/',
			customDomain: '',
		},
	},
	lastImageReport: {
		at: '2026-08-20T14:32:00+08:00',
		url: 'https://mp.weixin.qq.com/s/A4wmSktp8Zbui2CB8th_CA',
		uploaded: 11,
		failed: 0,
		errors: [],
	},
};

const STUB = `<script>
window.chrome = {
  storage: { local: {
    get: async (key) => { const d = ${JSON.stringify(DEMO)}; return key in d ? { [key]: d[key] } : {}; },
    set: async () => {}, remove: async () => {},
  }},
  permissions: { contains: async () => true, request: async () => true },
  runtime: { sendMessage: async () => ({ ok: true, message: '上传成功' }), openOptionsPage() {} },
  // popup 要读当前标签页
  tabs: { query: async () => [{ id: 1, title: '一篇文章的标题 - 某站', url: 'https://example.com/a' }] },
};
</script>`;

function findChrome() {
	const candidates = [
		process.env.CHROME_PATH,
		'C:/Program Files/Google/Chrome/Application/chrome.exe',
		'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
		join(process.env.LOCALAPPDATA ?? '', 'Google/Chrome/Application/chrome.exe'),
		'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
	].filter(Boolean);
	const found = candidates.find((p) => existsSync(p));
	if (!found) throw new Error('找不到 Chrome，用 CHROME_PATH 环境变量指一个');
	return found;
}

const MIME = { '.js': 'text/javascript', '.html': 'text/html', '.png': 'image/png', '.json': 'application/json' };

const server = createServer((req, res) => {
	const path = decodeURIComponent(req.url.split('?')[0]);
	try {
		if (path === '/' || path === `/${PAGE}.html`) {
			const html = readFileSync(join(REPO, `${PAGE}.html`), 'utf8')
				.replace(`<script type="module" src="${PAGE}.js">`, `${STUB}\n  <script type="module" src="${PAGE}.js">`);
			res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
			res.end(html);
			return;
		}
		const body = readFileSync(join(REPO, path.replace(/^\//, '')));
		res.writeHead(200, { 'Content-Type': MIME[extname(path)] ?? 'application/octet-stream' });
		res.end(body);
	} catch {
		res.writeHead(404);
		res.end('not found');
	}
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

await new Promise((r) => server.listen(PORT, r));

const profile = mkdtempSync(join(tmpdir(), 'shot-'));
const chrome = spawn(findChrome(), [
	'--headless=new', '--disable-gpu', '--hide-scrollbars',
	`--remote-debugging-port=${CDP_PORT}`,
	`--user-data-dir=${profile}`,
	'--no-first-run', '--no-default-browser-check',
	'--lang=zh-CN',
	'--window-size=600,1600',
	'about:blank',
], { stdio: 'ignore' });

try {
	for (let i = 0; i < 60; i += 1) {
		try {
			if ((await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`)).ok) break;
		} catch {
			await sleep(300);
		}
	}

	const target = await (
		await fetch(`http://127.0.0.1:${CDP_PORT}/json/new?${encodeURIComponent(`http://127.0.0.1:${PORT}/${PAGE}.html`)}`, { method: 'PUT' })
	).json();
	const ws = new WebSocket(target.webSocketDebuggerUrl);
	await new Promise((r) => ws.addEventListener('open', r, { once: true }));

	let id = 0;
	const pending = new Map();
	ws.addEventListener('message', (ev) => {
		const msg = JSON.parse(ev.data);
		if (msg.id && pending.has(msg.id)) {
			pending.get(msg.id)(msg);
			pending.delete(msg.id);
		}
	});
	const send = (method, params = {}) =>
		new Promise((resolve) => {
			id += 1;
			pending.set(id, resolve);
			ws.send(JSON.stringify({ id, method, params }));
		});

	await send('Page.enable');
	await sleep(2500);

	// 按内容实际高度截整页，不留大片空白。popup 得按 body 自己的宽度截，
	// 否则拿到的是视口宽度，看着和真实弹窗完全不是一个东西
	let width;
	let height;
	if (POPUP) {
		const box = await send('Runtime.evaluate', {
			expression: 'JSON.stringify([document.body.scrollWidth, document.body.scrollHeight])',
			returnByValue: true,
		});
		[width, height] = JSON.parse(box.result.result.value);
	} else {
		const metrics = await send('Page.getLayoutMetrics');
		const size = metrics.result?.cssContentSize ?? metrics.result?.contentSize;
		height = Math.ceil(size.height);
		width = Math.ceil(size.width);
	}

	const shot = await send('Page.captureScreenshot', {
		format: 'png',
		captureBeyondViewport: true,
		clip: { x: 0, y: 0, width, height, scale: 2 },
	});
	mkdirSync(dirname(OUT), { recursive: true });
	writeFileSync(OUT, Buffer.from(shot.result.data, 'base64'));
	console.log(`wrote ${OUT}  ${width}x${height} css px @2x`);
} finally {
	chrome.kill();
	server.close();
}
