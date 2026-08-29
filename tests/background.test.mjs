import test from 'node:test';
import assert from 'node:assert/strict';

test('扩展重复安装或更新时右键菜单保持单例', async () => {
	const menus = new Set(['clip-to-simplenote', 'upload-clipboard-image']);
	const calls = [];
	let onInstalled;

	globalThis.chrome = {
		runtime: {
			lastError: undefined,
			onInstalled: {
				addListener(listener) {
					onInstalled = listener;
				},
			},
			onMessage: { addListener() {} },
		},
		contextMenus: {
			onClicked: { addListener() {} },
			removeAll(callback) {
				calls.push('removeAll');
				menus.clear();
				callback();
			},
			create({ id }, callback) {
				calls.push(`create:${id}`);
				if (menus.has(id)) {
					chrome.runtime.lastError = { message: `Cannot create item with duplicate id ${id}` };
				} else {
					menus.add(id);
				}
				callback();
				chrome.runtime.lastError = undefined;
			},
		},
	};

	await import(`../background.js?context-menu=${Date.now()}`);
	assert.equal(typeof onInstalled, 'function');

	onInstalled();
	onInstalled();

	assert.deepEqual(calls, [
		'removeAll',
		'create:clip-to-simplenote',
		'create:upload-clipboard-image',
		'removeAll',
		'create:clip-to-simplenote',
		'create:upload-clipboard-image',
	]);
	assert.deepEqual([...menus], ['clip-to-simplenote', 'upload-clipboard-image']);
	assert.equal(chrome.runtime.lastError, undefined);

	delete globalThis.chrome;
});
