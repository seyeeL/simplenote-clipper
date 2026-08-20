// 阿里云 OSS 上传（图床）。用 V1 的 URL 签名，不是请求头签名：
// 请求头方案要发 Date 头，而 Date 是 fetch 规范里的禁止头，浏览器会静默删掉，
// 签名必然对不上。URL 签名把凭证放 query，不碰任何禁止头。
//
// 扩展在 service worker 里发请求，拿到 host 权限后不受 CORS 限制，
// 所以 bucket 不需要额外配 CORS 规则。

const DEFAULT_EXPIRES_SECONDS = 300;

export class OssError extends Error {
	constructor(code, message, status, detail = null) {
		super(message);
		this.name = 'OssError';
		this.code = code;
		this.status = status;
		// OSS 返回的原始诊断信息，排错时最关键的就是它
		this.detail = detail;
	}
}

/**
 * 解析 OSS 的错误 XML。service worker 里没有 DOMParser，只能正则取。
 * SignatureDoesNotMatch 的响应里会回显 OSS 自己算的 StringToSign，
 * 拿它和本地拼的对比就能定位签名差在哪一段。
 */
export function parseOssError(xml) {
	const pick = (tag) => {
		const match = String(xml ?? '').match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`));
		return match ? match[1].trim() : '';
	};
	return {
		code: pick('Code'),
		message: pick('Message'),
		stringToSign: pick('StringToSign'),
	};
}

// OSS 的错误码翻译成「下一步该做什么」
const OSS_HINTS = {
	InvalidAccessKeyId: 'AccessKey ID 不存在，检查有没有填错或者已被删除。',
	SignatureDoesNotMatch: 'AccessKey Secret 不对，或者 bucket / region 和密钥不属于同一个账号。',
	AccessDenied: '密钥有效但没有写权限，给这个 RAM 子账号加 oss:PutObject，并确认授权路径覆盖了填的前缀。',
	NoSuchBucket: 'Bucket 不存在，或者 region 填错了（bucket 和 region 必须对得上）。',
	RequestTimeTooSkewed: '本机时钟和 OSS 差太多，校准一下系统时间。',
	InvalidBucketName: 'Bucket 名字不合法。',
};

export function hintForOssCode(code) {
	return OSS_HINTS[code] ?? '';
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

/**
 * 签一个限时的 PUT 地址。
 * 连 stringToSign 一起返回：OSS 报 SignatureDoesNotMatch 时会回显它算的那份，
 * 两边一比就知道是格式错了还是密钥错了。
 * @returns {Promise<{url: string, stringToSign: string, expires: string}>}
 */
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
	return {
		url: `https://${ossHost(config)}/${encodeURI(key)}?${query}`,
		stringToSign,
		expires,
	};
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
	const { url, stringToSign } = await presignPutUrl({ config, key, contentType, now });
	let res;
	try {
		res = await fetch(url, {
			method: 'PUT',
			headers: { 'Content-Type': contentType },
			body,
		});
	} catch (err) {
		throw new OssError(
			'network_error',
			`连不上 OSS：${err?.message ?? err}。检查网络、region 是否正确，以及扩展是否拿到了跨域权限。`,
		);
	}

	if (!res.ok) {
		// 失败原因几乎都在 body 的 XML 里，不读就只剩一个没用的状态码
		const parsed = parseOssError(await res.text().catch(() => ''));
		const hint = hintForOssCode(parsed.code);
		const parts = [`上传失败 HTTP ${res.status}`];
		if (parsed.code) parts.push(parsed.code);
		if (parsed.message) parts.push(parsed.message);
		if (hint) parts.push(hint);
		throw new OssError(parsed.code || 'upload_failed', parts.join('｜'), res.status, {
			...parsed,
			localStringToSign: stringToSign,
		});
	}
	return publicUrl({ config, key });
}

// 1×1 透明 PNG，70 字节。连通性自检用，传上去也不占地方
const PROBE_PNG_BASE64 =
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

/**
 * 传一张 1×1 PNG 自检。剪藏时逐张失败很难看出是哪一环，
 * 这里把 OSS 的原始错误码原样带出来。
 */
export async function probeUpload(config) {
	const body = Uint8Array.from(atob(PROBE_PNG_BASE64), (c) => c.charCodeAt(0));
	const key = buildObjectKey({ prefix: config.path, hash: 'probe0000probe00', ext: 'png' });
	const url = await putObject({ config, key, body, contentType: 'image/png' });
	return { key, url };
}
