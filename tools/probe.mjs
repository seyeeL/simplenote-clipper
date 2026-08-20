// 对真实页面跑一遍提取：起一个独立 profile 的 Chrome，把 lib/extract.js 和
// lib/html2md.js 注进页面执行。抓请求看不到 JS 渲染出来的正文，只能看真 DOM。
//
//   node tools/probe.mjs <url>          提取结果（标题 / 正文开头 / 选中的容器）
//   node tools/probe.mjs <url> --dump   页面里文字量最大的容器，定位「正文在哪」
//   node tools/probe.mjs <url> --wx     用微信 UA（公众号链接需要）
//   node tools/probe.mjs <url> --show   开真窗口，不用 headless
//   node tools/probe.mjs <url> --attach[=端口]
//                                       不开新浏览器，连已经开着调试端口的那个，
//                                       在已打开的 tab 里跑（默认 9222）
//
// 默认用独立 user-data-dir，不碰你正在用的 Chrome 和登录态。要登录才给内容的站点
// （小红书干净 profile 只会拿到风控拦截页）用 --attach：先在那个浏览器里登录并打开
// 目标页，这里只是连上去执行，同样不读 cookie。
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
const flag = (name) => process.argv.some((a) => a === `--${name}` || a.startsWith(`--${name}=`));
const flagValue = (name, fallback) => {
	const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
	return hit ? hit.slice(name.length + 3) : fallback;
};
const ATTACH = flag('attach');
const ATTACH_PORT = flagValue('attach', '9222');

if (!url) {
	console.error('用法: node tools/probe.mjs <url> [--dump] [--wx] [--show]');
	process.exit(1);
}

// 全局 fetch / WebSocket 是 Node 22 才都齐的。缺了会在下面的重试循环里被
// catch 吃掉，最后报成「Chrome 没起来」——查半天查到 node 版本上。
const missing = ['fetch', 'WebSocket'].filter((name) => typeof globalThis[name] !== 'function');
if (missing.length) {
	console.error(`需要 Node 22+（缺少全局 ${missing.join(' / ')}），当前是 ${process.version}。`);
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
// attach 模式下不开浏览器，也就没有进程要收
const chrome = ATTACH ? null : spawn(findChrome(), [
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

/** 已经开着的浏览器里找那个 tab。传的 URL 常带 xsec_token 之类的参数，用路径匹配更稳。 */
async function attachTarget() {
	const list = await (await fetch(`http://127.0.0.1:${ATTACH_PORT}/json/list`)).json();
	const pages = list.filter((t) => t.type === 'page');
	let key = url;
	try {
		key = new URL(url).pathname;
	} catch {
		// 传的不是完整 URL，当子串用
	}
	const found = pages.find((t) => t.url.includes(url)) ?? pages.find((t) => t.url.includes(key));
	if (found) return found;
	const opened = pages.map((t) => t.url).join('\n  ');
	throw new Error(
		`那个浏览器里没有匹配 ${key} 的标签页，先在它里面打开目标页。` +
			`\n当前开着：\n  ${opened}`,
	);
}

try {
	const port = ATTACH ? ATTACH_PORT : PORT;
	let ready = false;
	let lastError = '';
	for (let i = 0; i < (ATTACH ? 3 : 80) && !ready; i += 1) {
		try {
			ready = (await fetch(`http://127.0.0.1:${port}/json/version`)).ok;
		} catch (err) {
			lastError = err?.message || String(err);
			await sleep(300);
		}
	}
	// 端口一直连不上的原因五花八门（Chrome 起不来、端口被占、代理拦本地回环），
	// 把最后一次的报错带出来，别让调用方对着一句「没起来」猜
	if (!ready && ATTACH) {
		throw new Error(`连不上 127.0.0.1:${port}（${lastError || '未知原因'}）。那个浏览器要带 --remote-debugging-port 启动。`);
	}
	if (!ready) throw new Error(`Chrome 没起来（127.0.0.1:${port} 连不上：${lastError || '未知原因'}）`);

	const target = ATTACH
		? await attachTarget()
		: await (
			await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' })
		).json();
	const ws = new WebSocket(target.webSocketDebuggerUrl);
	await new Promise((r) => ws.addEventListener('open', r, { once: true }));
	const client = cdp(ws);

	await client.send('Page.enable');
	await client.send('Runtime.enable');
	// attach 的页面早就加载完了，Page.loadEventFired 不会再来一次
	if (!ATTACH) {
		for (let i = 0; i < 40 && !client.loaded(); i += 1) await sleep(300);
		// 等首屏 JS 把正文塞进 DOM
		await sleep(6000);
	}

	const res = await client.send('Runtime.evaluate', {
		expression: flag('dump') ? DUMP_EXPR : EXTRACT_EXPR,
		returnByValue: true,
		awaitPromise: true,
	});
	console.log(res.result?.result?.value ?? JSON.stringify(res.result, null, 2));
} finally {
	chrome?.kill();
}
