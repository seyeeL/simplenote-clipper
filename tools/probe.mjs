// 对真实页面跑一遍提取：起一个独立 profile 的 Chrome，把 lib/extract.js 和
// lib/html2md.js 注进页面执行。抓请求看不到 JS 渲染出来的正文，只能看真 DOM。
//
//   node tools/probe.mjs <url>          提取结果（标题 / 正文开头 / 选中的容器）
//   node tools/probe.mjs <url> --dump   页面里文字量最大的容器，定位「正文在哪」
//   node tools/probe.mjs <url> --wx     用微信 UA（公众号链接需要）
//   node tools/probe.mjs <url> --show   开真窗口，不用 headless
//
// 用独立 user-data-dir，不碰你正在用的 Chrome 和登录态。
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = dirname(dirname(fileURLToPath(import.meta.url)));
const PORT = 9333;
const WECHAT_UA =
	'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 ' +
	'(KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.40(0x18002832) NetType/WIFI Language/zh_CN';

const url = process.argv[2];
const flag = (name) => process.argv.includes(`--${name}`);

if (!url) {
	console.error('用法: node tools/probe.mjs <url> [--dump] [--wx] [--show]');
	process.exit(1);
}

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

/** 把两个 ESM 模块拼成能直接 eval 的一段脚本（页面里没法 import 扩展的文件）。 */
function bundle() {
	const strip = (rel) =>
		readFileSync(join(REPO, rel), 'utf8')
			.replace(/^import .*$/gm, '')
			.replace(/^export /gm, '');
	// site-rules 在最前：extract.js 依赖它
	return [strip('lib/site-rules.js'), strip('lib/html2md.js'), strip('lib/extract.js')].join('\n');
}

function cdp(ws) {
	let id = 0;
	const pending = new Map();
	const seen = new Set();
	ws.addEventListener('message', (ev) => {
		const msg = JSON.parse(ev.data);
		if (msg.id && pending.has(msg.id)) {
			pending.get(msg.id)(msg);
			pending.delete(msg.id);
		} else if (msg.method) {
			seen.add(msg.method);
		}
	});
	return {
		send: (method, params = {}) =>
			new Promise((resolve) => {
				id += 1;
				pending.set(id, resolve);
				ws.send(JSON.stringify({ id, method, params }));
			}),
		loaded: () => seen.has('Page.loadEventFired'),
	};
}

const EXTRACT_EXPR = `(() => { ${bundle()}
  const a = extractArticle(document, location.href);
  const desc = (e) => e && (e.tagName + (e.id ? '#' + e.id : '') +
    (typeof e.className === 'string' && e.className.trim() ? '.' + e.className.trim().split(/\\s+/)[0] : ''));
  const md = htmlToMarkdown(a.root);
  return JSON.stringify({
    title: a.title, author: a.author, publishedAt: a.publishedAt, siteName: a.siteName,
    root: desc(a.root), mdLen: md.length, mdHead: md.slice(0, 1200),
  }, null, 2); })()`;

// 站点无关的诊断：文字量最大的那些容器就是正文候选，看它们的 class 能判断
// 是没选中容器，还是选中了但被噪声过滤删了
const DUMP_EXPR = `(() => {
  const desc = (e) => e.tagName + (e.id ? '#' + e.id : '') +
    (typeof e.className === 'string' && e.className.trim() ? '.' + e.className.trim().split(/\\s+/).join('.') : '');
  const heavy = [];
  for (const e of document.querySelectorAll('div,section,article,main,p')) {
    const len = e.textContent.trim().length;
    if (len > 200) heavy.push({ el: desc(e).slice(0, 100), len });
  }
  heavy.sort((a, b) => b.len - a.len);
  return JSON.stringify({
    counts: Object.fromEntries(['p','section','div','article','img'].map((t) => [t, document.querySelectorAll(t).length])),
    heavy: heavy.slice(0, 12),
  }, null, 2); })()`;

const profile = mkdtempSync(join(tmpdir(), 'sn-probe-'));
const chrome = spawn(findChrome(), [
	...(flag('show') ? ['--window-position=-3000,0'] : ['--headless=new', '--disable-gpu']),
	`--remote-debugging-port=${PORT}`,
	`--user-data-dir=${profile}`,
	'--no-first-run',
	'--no-default-browser-check',
	'--window-size=1280,2000',
	...(flag('wx') ? [`--user-agent=${WECHAT_UA}`] : []),
	'about:blank',
], { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

try {
	let ready = false;
	for (let i = 0; i < 80 && !ready; i += 1) {
		try {
			ready = (await fetch(`http://127.0.0.1:${PORT}/json/version`)).ok;
		} catch {
			await sleep(300);
		}
	}
	if (!ready) throw new Error('Chrome 没起来');

	const target = await (
		await fetch(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' })
	).json();
	const ws = new WebSocket(target.webSocketDebuggerUrl);
	await new Promise((r) => ws.addEventListener('open', r, { once: true }));
	const client = cdp(ws);

	await client.send('Page.enable');
	await client.send('Runtime.enable');
	for (let i = 0; i < 40 && !client.loaded(); i += 1) await sleep(300);
	// 等首屏 JS 把正文塞进 DOM
	await sleep(6000);

	const res = await client.send('Runtime.evaluate', {
		expression: flag('dump') ? DUMP_EXPR : EXTRACT_EXPR,
		returnByValue: true,
		awaitPromise: true,
	});
	console.log(res.result?.result?.value ?? JSON.stringify(res.result, null, 2));
} finally {
	chrome.kill();
}
