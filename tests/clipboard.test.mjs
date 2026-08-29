import test from 'node:test';
import assert from 'node:assert/strict';

import { firstImageType, markdownImageLink, uploadClipboardImage } from '../offscreen.js';

test('图片类型选择和 Markdown 链接格式稳定', () => {
	assert.equal(firstImageType(['text/plain', 'image/png']), 'image/png');
	assert.equal(firstImageType(['TEXT/PLAIN', 'IMAGE/WEBP']), 'IMAGE/WEBP');
	assert.equal(firstImageType(['text/html']), '');
	assert.equal(markdownImageLink('https://img.example.com/a.png'), '![](https://img.example.com/a.png)');
});

test('剪贴板图片上传到 OSS 后把 Markdown 链接写回剪贴板', async (t) => {
	const imageBytes = new Uint8Array([137, 80, 78, 71]);
	const originalNavigator = globalThis.navigator;
	const originalDocument = globalThis.document;
	const originalFetch = globalThis.fetch;
	let copied = '';
	let request;
	const output = {
		value: '',
		select() {},
	};

	Object.defineProperty(globalThis, 'navigator', {
		configurable: true,
		value: {
			clipboard: {
				read: async () => [
					{
						types: ['image/png'],
						getType: async () => new Blob([imageBytes], { type: 'image/png' }),
					},
				],
			},
		},
	});
	globalThis.document = {
		querySelector: (selector) => {
			assert.equal(selector, '#clipboard-output');
			return output;
		},
		execCommand: (command) => {
			assert.equal(command, 'copy');
			copied = output.value;
			return true;
		},
	};
	globalThis.fetch = async (url, init) => {
		request = { url, init };
		return { ok: true };
	};
	t.after(() => {
		Object.defineProperty(globalThis, 'navigator', { configurable: true, value: originalNavigator });
		globalThis.document = originalDocument;
		globalThis.fetch = originalFetch;
	});

	const result = await uploadClipboardImage({
		oss: {
			accessKeyId: 'AK',
			accessKeySecret: 'SK',
			bucket: 'bucket',
			region: 'oss-cn-beijing',
			path: 'clipper/',
			customDomain: 'img.example.com',
		},
		maxBytes: 1024,
	});

	assert.match(result.url, /^https:\/\/img\.example\.com\/clipper\/\d{4}-\d{2}\/[a-f0-9]{16}\.png$/);
	assert.equal(result.markdown, `![](${result.url})`);
	assert.equal(copied, result.markdown);
	assert.equal(result.bytes, imageBytes.byteLength);
	assert.equal(request.init.method, 'PUT');
	assert.equal(request.init.headers['Content-Type'], 'image/png');
	assert.deepEqual(new Uint8Array(request.init.body), imageBytes);
});
