import { extensionFor, sha256Hex } from './lib/images.js';
import { buildObjectKey, putObject } from './lib/oss.js';

const MESSAGE_TARGET = 'clipboard-offscreen';
const PASTE_TIMEOUT_MS = 2000;

export function markdownImageLink(url) {
	return `![](${url})`;
}

export function firstImageType(types = []) {
	return Array.from(types).find((type) => String(type).toLowerCase().startsWith('image/')) ?? '';
}

async function readWithClipboardApi() {
	const items = await navigator.clipboard.read();
	for (const item of items) {
		const type = firstImageType(item.types);
		if (type) return item.getType(type);
	}
	throw new Error('剪贴板里没有图片。');
}

function readWithPasteCommand() {
	return new Promise((resolve, reject) => {
		const editor = document.createElement('div');
		editor.contentEditable = 'true';
		editor.setAttribute('aria-hidden', 'true');
		editor.style.cssText = 'position:fixed;left:-10000px;top:0;width:1px;height:1px;overflow:hidden';

		let settled = false;
		const finish = (callback, value) => {
			if (settled) return;
			settled = true;
			clearTimeout(timeout);
			editor.removeEventListener('paste', onPaste);
			editor.remove();
			callback(value);
		};
		const onPaste = (event) => {
			event.preventDefault();
			for (const item of event.clipboardData?.items ?? []) {
				if (item.kind !== 'file' || !item.type.toLowerCase().startsWith('image/')) continue;
				const blob = item.getAsFile();
				if (blob) {
					finish(resolve, blob);
					return;
				}
			}
			finish(reject, new Error('剪贴板里没有图片。'));
		};
		const timeout = setTimeout(
			() => finish(reject, new Error('浏览器没有允许读取剪贴板，请重试。')),
			PASTE_TIMEOUT_MS,
		);

		editor.addEventListener('paste', onPaste);
		document.body.appendChild(editor);
		editor.focus();
		if (!document.execCommand('paste')) {
			finish(reject, new Error('浏览器没有允许读取剪贴板，请重试。'));
		}
	});
}

async function readClipboardImage() {
	if (navigator.clipboard?.read) {
		try {
			return await readWithClipboardApi();
		} catch (err) {
			// 离屏文档不能获得窗口焦点，Chrome 可能拒绝现代 Clipboard API；
			// 有 clipboardRead 权限时，扩展页仍可用 paste 命令读取二进制图片。
			if (err?.message === '剪贴板里没有图片。') throw err;
		}
	}
	return readWithPasteCommand();
}

function copyText(text) {
	const output = document.querySelector('#clipboard-output');
	output.value = text;
	output.select();
	const copied = document.execCommand('copy');
	output.value = '';
	if (!copied) throw new Error('图片已上传，但 Markdown 链接写回剪贴板失败。');
}

export async function uploadClipboardImage({ oss, maxBytes }) {
	const blob = await readClipboardImage();
	const body = await blob.arrayBuffer();
	if (!body.byteLength) throw new Error('剪贴板图片是空的。');
	if (body.byteLength > maxBytes) throw new Error(`剪贴板图片超过 ${Math.floor(maxBytes / 1024 / 1024)} MB 上限。`);

	const contentType = blob.type.split(';')[0].trim().toLowerCase() || 'image/png';
	const key = buildObjectKey({
		prefix: oss.path,
		hash: await sha256Hex(body),
		ext: extensionFor(contentType),
	});
	const url = await putObject({ config: oss, key, body, contentType });
	const markdown = markdownImageLink(url);
	copyText(markdown);
	return { url, markdown, bytes: body.byteLength };
}

if (globalThis.chrome?.runtime?.onMessage) {
	chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
		if (message?.target !== MESSAGE_TARGET || message?.type !== 'upload-clipboard-image') return false;
		uploadClipboardImage(message.payload ?? {})
			.then((result) => sendResponse({ ok: true, ...result }))
			.catch((err) => sendResponse({ ok: false, message: err?.message ?? String(err) }));
		return true;
	});
}
