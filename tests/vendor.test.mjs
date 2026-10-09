import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { contentHash } from '../tools/sync-web-extract.mjs';

const manifest = JSON.parse(readFileSync(new URL('../lib/web-extract.json', import.meta.url), 'utf8'));

test('lib/ 里 web-extract 的副本没有被直接改过', () => {
	// 页面解析的真源在 web-extract 仓库。在这里改了副本，下次同步就被冲掉，
	// 那边的测试和其它下游也拿不到这个修复
	assert.ok(Object.keys(manifest.files).length >= 3);
	for (const [file, hash] of Object.entries(manifest.files)) {
		const text = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
		assert.equal(
			contentHash(text),
			hash,
			`${file} 和 web-extract@${manifest.commit.slice(0, 12)} 对不上。` +
				'去 web-extract 改、提交，再跑 npm run sync:web-extract',
		);
	}
});

test('副本里点名的模块都在 web_accessible_resources 里', () => {
	// 注入脚本靠 import() 取这几个文件，漏声明页面直接 ReferenceError
	const resources = JSON.parse(readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'))
		.web_accessible_resources.flatMap((entry) => entry.resources);
	for (const file of Object.keys(manifest.files)) assert.ok(resources.includes(file), file);
});
