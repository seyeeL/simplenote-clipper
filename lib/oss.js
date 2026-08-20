// 阿里云 OSS 上传（图床）。用 V1 的 URL 签名，不是请求头签名：
// 请求头方案要发 Date 头，而 Date 是 fetch 规范里的禁止头，浏览器会静默删掉，
// 签名必然对不上。URL 签名把凭证放 query，不碰任何禁止头。
//
// 扩展在 service worker 里发请求，拿到 host 权限后不受 CORS 限制，
// 所以 bucket 不需要额外配 CORS 规则。

const DEFAULT_EXPIRES_SECONDS = 300;

export class OssError extends Error {
	constructor(code, message, status) {
		super(message);
		this.name = 'OssError';
		this.code = code;
		this.status = status;
	}
}

/** x-oss-* 头要小写、去空白、按名字排序，每条以换行结尾。普通上传用不到，留着是为了能对官方用例。 */
export function canonicalizedOssHeaders(headers = {}) {
	return Object.entries(headers)
		.map(([name, value]) => [String(name).toLowerCase().trim(), String(value).trim()])
		.filter(([name]) => name.startsWith('x-oss-'))
		.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
		.map(([name, value]) => `${name}:${value}\n`)
		.join('');
}

/**
 * 拼 StringToSign。第四段在请求头签名里是 Date，在 URL 签名里是 Expires，
 * 两种模式共用同一个位置，所以这里叫 dateOrExpires。
 */
export function buildStringToSign({
	method = 'PUT',
	contentMd5 = '',
	contentType = '',
	dateOrExpires = '',
	headers = {},
	resource = '',
} = {}) {
	return [
		method,
		contentMd5,
		contentType,
		dateOrExpires,
		`${canonicalizedOssHeaders(headers)}${resource}`,
	].join('\n');
}

export async function hmacSha1Base64(secret, message) {
	const encoder = new TextEncoder();
	const key = await crypto.subtle.importKey(
		'raw',
		encoder.encode(secret),
		{ name: 'HMAC', hash: 'SHA-1' },
		false,
		['sign'],
	);
	const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(message));
	return btoa(String.fromCharCode(...new Uint8Array(signature)));
}

export function ossHost({ bucket, region }) {
	return `${bucket}.${region}.aliyuncs.com`;
}

/** 配置齐不齐。缺一项就别走图床，直接留原图链接。 */
export function isOssConfigured(config) {
	return Boolean(config?.enabled && config.accessKeyId && config.accessKeySecret && config.bucket && config.region);
}

/**
 * 生成对象名。按内容哈希命名：同一张图重复剪藏不会传两份，
 * 也不会因为原站文件名重复而互相覆盖。
 */
export function buildObjectKey({ prefix = '', hash = '', ext = 'bin', now = Date.now() } = {}) {
	const d = new Date(now);
	const month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
	const dir = String(prefix).replace(/^\/+/, '').replace(/\/*$/, prefix ? '/' : '');
	return `${dir}${month}/${hash.slice(0, 16)}.${ext}`;
}

/** 签一个限时的 PUT 地址。 */
export async function presignPutUrl({
	config,
	key,
	contentType = 'application/octet-stream',
	expiresSeconds = DEFAULT_EXPIRES_SECONDS,
	now = Date.now(),
}) {
	const expires = String(Math.floor(now / 1000) + expiresSeconds);
	// CanonicalizedResource 用未编码的对象名；我们的 key 只有 ASCII，编码前后一致
	const stringToSign = buildStringToSign({
		method: 'PUT',
		contentType,
		dateOrExpires: expires,
		resource: `/${config.bucket}/${key}`,
	});
	const signature = await hmacSha1Base64(config.accessKeySecret, stringToSign);
	const query = new URLSearchParams({
		OSSAccessKeyId: config.accessKeyId,
		Expires: expires,
		Signature: signature,
	});
	return `https://${ossHost(config)}/${encodeURI(key)}?${query}`;
}

/** 上传后对外可访问的地址。配了自定义域名就用它。 */
export function publicUrl({ config, key }) {
	const domain = String(config.customDomain ?? '').trim().replace(/\/+$/, '');
	if (domain) {
		const base = /^https?:\/\//i.test(domain) ? domain : `https://${domain}`;
		return `${base}/${encodeURI(key)}`;
	}
	return `https://${ossHost(config)}/${encodeURI(key)}`;
}

/**
 * PUT 一个对象上去。Content-Type 必须和签名时用的一致，否则 OSS 判签名不符。
 * @returns {Promise<string>} 对外可访问的地址
 */
export async function putObject({ config, key, body, contentType, now = Date.now() }) {
	const url = await presignPutUrl({ config, key, contentType, now });
	let res;
	try {
		res = await fetch(url, {
			method: 'PUT',
			headers: { 'Content-Type': contentType },
			body,
		});
	} catch (err) {
		throw new OssError('network_error', `连不上 OSS：${err?.message ?? err}`);
	}

	if (res.status === 403) {
		throw new OssError('forbidden', 'OSS 拒绝上传：AccessKey 或 bucket 权限不对。', 403);
	}
	if (!res.ok) {
		throw new OssError('upload_failed', `上传失败（HTTP ${res.status}）。`, res.status);
	}
	return publicUrl({ config, key });
}
