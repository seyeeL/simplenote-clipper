// 把 web-extract 的页面解析模块同步成 lib/ 下的副本。
//
// 真源在 https://github.com/seyeeL/web-extract。lib/extract.js、lib/html2md.js、
// lib/site-rules.js 是它 src/ 下同名文件的副本，别在这里直接改：改 web-extract，
// 跑那边的测试，提交，再回来跑这个脚本。tests/vendor.test.mjs 会拦住直接改副本的情况。
//
//   node tools/sync-web-extract.mjs [web-extract 目录]     默认 ../web-extract
//   node tools/sync-web-extract.mjs <目录> --allow-dirty    那边有没提交的改动也照样同步（只用于试验）
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = dirname(dirname(fileURLToPath(import.meta.url)));
const MANIFEST = join(REPO, 'lib', 'web-extract.json');
// lib/ 下的文件名 → web-extract 里的路径
const FILES = {
	'lib/extract.js': 'src/extract.js',
	'lib/html2md.js': 'src/html2md.js',
	'lib/site-rules.js': 'src/site-rules.js',
};

/** 换行统一成 LF 再算：Windows 上 git 的 autocrlf 会把工作区文件换成 CRLF。 */
export function contentHash(text) {
	return createHash('sha256').update(String(text).replace(/\r\n/g, '\n')).digest('hex');
}

function git(dir, ...args) {
	return execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' }).trim();
}

function main() {
	const args = process.argv.slice(2);
	const allowDirty = args.includes('--allow-dirty');
	const source = resolve(args.find((a) => !a.startsWith('--')) ?? join(REPO, '..', 'web-extract'));
	if (!existsSync(join(source, 'src', 'extract.js'))) {
		throw new Error(`${source} 不像 web-extract 仓库（没有 src/extract.js）。把目录作为第一个参数传进来。`);
	}

	const dirty = git(source, 'status', '--porcelain', '--', ...Object.values(FILES));
	if (dirty && !allowDirty) {
		throw new Error(`web-extract 里这几个文件还有没提交的改动，先在那边提交：\n${dirty}`);
	}
	const commit = git(source, 'rev-parse', 'HEAD');

	const files = {};
	for (const [target, from] of Object.entries(FILES)) {
		const text = readFileSync(join(source, from), 'utf8').replace(/\r\n/g, '\n');
		writeFileSync(join(REPO, target), text, 'utf8');
		files[target] = contentHash(text);
	}
	const manifest = {
		source: 'https://github.com/seyeeL/web-extract',
		commit: dirty ? `${commit}+dirty` : commit,
		files,
	};
	writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
	console.log(`已同步 web-extract@${manifest.commit.slice(0, 12)}：${Object.keys(FILES).join('、')}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	try {
		main();
	} catch (err) {
		console.error(err.message);
		process.exitCode = 1;
	}
}
