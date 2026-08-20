import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';

import {
	buildObjectKey,
	buildStringToSign,
	canonicalizedOssHeaders,
	hmacSha1Base64,
	isOssConfigured,
	ossHost,
	presignPutUrl,
	publicUrl,
} from '../lib/oss.js';

// 阿里云文档里的签名示例现在是打码的（AccessKeySecret 和 Signature 都是 ****），
// 拿不到可用的官方向量。改成差分测试：同一份输入用 Node 内置 crypto 独立算一遍，
// 两条路径必须一致。这能抓住 key 导入、字节序、base64 这几类错，不是自己验自己。
function nodeHmacSha1Base64(secret, message) {
	return createHmac('sha1', secret).update(message, 'utf8').digest('base64');
}

test('WebCrypto 的 HMAC-SHA1 + base64 与 node:crypto 结果一致', async () => {
	const cases = [
		['SK', 'PUT\n\nimage/png\n1755000300\n/b/k.png'],
		['OtxrzxIsfpFjA7SwPzILwy8Bw21TLhquhboDYROV', 'PUT\n\ntext/html\nThu, 17 Nov 2005 18:49:58 GMT\n/oss-example/nelson'],
		// 非 ASCII 的 key 和内容，验 TextEncoder 那一步没把 UTF-8 编错
		['密钥🔑', 'PUT\n\nimage/jpeg\n1\n/桶/图片.jpg'],
	];
	for (const [secret, message] of cases) {
		assert.equal(
			await hmacSha1Base64(secret, message),
			nodeHmacSha1Base64(secret, message),
			`secret=${JSON.stringify(secret)} 时两条实现不一致`,
		);
	}
});

test('空 AccessKeySecret 会被 WebCrypto 拒绝，所以要靠 isOssConfigured 先挡住', async () => {
	// node:crypto 接受零长度 HMAC key，WebCrypto 不接受。两边这点行为不同，
	// 生产路径上不会走到：配置不全时根本不进图床分支。
	await assert.rejects(() => hmacSha1Base64('', 'PUT\n\n\n0\n/b/k'));
	assert.equal(isOssConfigured({ enabled: true, accessKeyId: 'AK', accessKeySecret: '', bucket: 'b', region: 'r' }), false);
});

test('buildStringToSign 按文档的五段结构拼', () => {
	// 结构取自阿里云 V1 签名文档（这部分没打码）：
	// VERB \n Content-MD5 \n Content-Type \n Date \n CanonicalizedOSSHeaders + CanonicalizedResource
	const built = buildStringToSign({
		method: 'PUT',
		contentMd5: 'ODBGOERFMDMzQTczRUY3NUE3NzA5QzdFNUYzMDQxNEM',
		contentType: 'text/html',
		dateOrExpires: 'Wed, 28 Dec 2022 10:27:41 GMT',
		headers: {
			'X-OSS-Meta-Magic': 'abracadabra',
			'X-OSS-Meta-Author': 'alice',
			Host: 'oss-example.oss-cn-hangzhou.aliyuncs.com',
		},
		resource: '/oss-example/nelson',
	});
	assert.equal(
		built,
		[
			'PUT',
			'ODBGOERFMDMzQTczRUY3NUE3NzA5QzdFNUYzMDQxNEM',
			'text/html',
			'Wed, 28 Dec 2022 10:27:41 GMT',
			// 文档要求 x-oss-* 按名字字典序升序，author 排在 magic 前面
			'x-oss-meta-author:alice',
			'x-oss-meta-magic:abracadabra',
			'/oss-example/nelson',
		].join('\n'),
	);
});

test('CanonicalizedOSSHeaders 只留 x-oss-*，小写并按名字排序', () => {
	assert.equal(
		canonicalizedOssHeaders({ 'X-OSS-B': ' 2 ', 'x-oss-a': '1', 'Content-Type': 'text/html' }),
		'x-oss-a:1\nx-oss-b:2\n',
	);
	assert.equal(canonicalizedOssHeaders({}), '');
});

test('普通上传没有 x-oss-* 头时第五段就是资源路径', () => {
	assert.equal(
		buildStringToSign({ contentType: 'image/png', dateOrExpires: '1755000000', resource: '/b/k.png' }),
		'PUT\n\nimage/png\n1755000000\n/b/k.png',
	);
});

test('presignPutUrl 把凭证放 query —— Date 是 fetch 禁止头，走请求头签名会被静默删掉', async () => {
	const config = {
		accessKeyId: 'AK',
		accessKeySecret: 'SK',
		bucket: 'my-bucket',
		region: 'oss-cn-beijing',
	};
	const url = new URL(
		await presignPutUrl({
			config,
			key: 'clipper/2026-08/abc.png',
			contentType: 'image/png',
			expiresSeconds: 300,
			now: 1_755_000_000_000,
		}),
	);

	assert.equal(url.origin, 'https://my-bucket.oss-cn-beijing.aliyuncs.com');
	assert.equal(url.pathname, '/clipper/2026-08/abc.png');
	assert.equal(url.searchParams.get('OSSAccessKeyId'), 'AK');
	assert.equal(url.searchParams.get('Expires'), '1755000300');
	// 签名要和同样入参手算出来的一致
	assert.equal(
		url.searchParams.get('Signature'),
		await hmacSha1Base64('SK', 'PUT\n\nimage/png\n1755000300\n/my-bucket/clipper/2026-08/abc.png'),
	);
});

test('对象名按内容哈希 + 年月分目录，同一张图不会传两份', () => {
	const key = buildObjectKey({
		prefix: 'clipper/',
		hash: 'abcdef0123456789ffff',
		ext: 'png',
		now: new Date(2026, 7, 20).getTime(),
	});
	assert.equal(key, 'clipper/2026-08/abcdef0123456789.png');
});

test('路径前缀漏了斜杠或多了斜杠都能收干净', () => {
	const now = new Date(2026, 7, 20).getTime();
	const args = { hash: 'a'.repeat(20), ext: 'jpg', now };
	assert.equal(buildObjectKey({ ...args, prefix: 'clipper' }), 'clipper/2026-08/aaaaaaaaaaaaaaaa.jpg');
	assert.equal(buildObjectKey({ ...args, prefix: '/clipper//' }), 'clipper/2026-08/aaaaaaaaaaaaaaaa.jpg');
	assert.equal(buildObjectKey({ ...args, prefix: '' }), '2026-08/aaaaaaaaaaaaaaaa.jpg');
});

test('publicUrl 优先用自定义域名，没有协议就补 https', () => {
	const config = { bucket: 'b', region: 'oss-cn-beijing' };
	assert.equal(publicUrl({ config, key: 'a/b.png' }), 'https://b.oss-cn-beijing.aliyuncs.com/a/b.png');
	assert.equal(
		publicUrl({ config: { ...config, customDomain: 'https://img.example.com/' }, key: 'a/b.png' }),
		'https://img.example.com/a/b.png',
	);
	assert.equal(
		publicUrl({ config: { ...config, customDomain: 'img.example.com' }, key: 'a/b.png' }),
		'https://img.example.com/a/b.png',
	);
});

test('ossHost 拼 bucket.region.aliyuncs.com', () => {
	assert.equal(ossHost({ bucket: 'b', region: 'oss-cn-beijing' }), 'b.oss-cn-beijing.aliyuncs.com');
});

test('配置缺一项就不算配好，缺了直接走原图链接', () => {
	const full = {
		enabled: true,
		accessKeyId: 'AK',
		accessKeySecret: 'SK',
		bucket: 'b',
		region: 'oss-cn-beijing',
	};
	assert.equal(isOssConfigured(full), true);
	assert.equal(isOssConfigured({ ...full, enabled: false }), false);
	for (const key of ['accessKeyId', 'accessKeySecret', 'bucket', 'region']) {
		assert.equal(isOssConfigured({ ...full, [key]: '' }), false, `缺 ${key} 应判未配置`);
	}
	assert.equal(isOssConfigured(undefined), false);
});
