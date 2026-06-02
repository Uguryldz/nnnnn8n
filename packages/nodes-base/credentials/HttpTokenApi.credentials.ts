import type {
	GenericValue,
	ICredentialDataDecryptedObject,
	ICredentialType,
	IHttpRequestHelper,
	INodeProperties,
	IAuthenticateGeneric,
	ICredentialTestRequest,
	IHttpRequestMethods,
	Icon,
} from 'n8n-workflow';

type PathSegment = { key: string } | { index: number };

function parsePath(path: string): PathSegment[] {
	if (!path?.trim()) return [];
	const segments: PathSegment[] = [];
	const regex = /([^.[\]]+)|\[(\d+)\]/g;
	let m: RegExpExecArray | null;
	while ((m = regex.exec(path.trim())) !== null) {
		if (m[1] != null) segments.push({ key: m[1] });
		else if (m[2] != null) segments.push({ index: parseInt(m[2], 10) });
	}
	return segments;
}

function getByPath(obj: unknown, path: string): unknown {
	let cur: unknown = obj;
	for (const seg of parsePath(path)) {
		if (cur == null || typeof cur !== 'object') return undefined;
		if ('key' in seg) {
			const r = cur as Record<string, unknown>;
			if (!(seg.key in r)) return undefined;
			cur = r[seg.key];
		} else {
			if (!Array.isArray(cur) || seg.index < 0 || seg.index >= cur.length) return undefined;
			cur = cur[seg.index];
		}
	}
	return cur;
}

function findFirstKey(
	obj: unknown,
	keyName: string,
	seen: WeakSet<object> = new WeakSet(),
): unknown {
	if (obj == null || typeof obj !== 'object') return undefined;
	const key = keyName.trim();
	if (!key) return undefined;
	if (Array.isArray(obj)) {
		for (const item of obj) {
			const v = findFirstKey(item, keyName, seen);
			if (v !== undefined) return v;
		}
		return undefined;
	}
	const r = obj as Record<string, unknown>;
	if (seen.has(r)) return undefined;
	seen.add(r);
	if (Object.prototype.hasOwnProperty.call(r, key)) {
		const val = r[key];
		if (val != null) return val;
	}
	for (const k of Object.keys(r)) {
		const v = findFirstKey(r[k], keyName, seen);
		if (v !== undefined) return v;
	}
	return undefined;
}

function getByExpression(body: unknown, expression: string): unknown {
	const code = expression?.trim();
	if (!code) return undefined;
	try {
		// eslint-disable-next-line @typescript-eslint/no-implied-eval
		const fn = new Function('body', `"use strict"; return (${code});`);
		return fn(body);
	} catch {
		return undefined;
	}
}

/** Raw/XML metin üzerinde regex ile tek yakalama grubundan token döndürür. */
function getByRegex(body: unknown, pattern: string): unknown {
	const str = typeof body === 'string' ? body : body == null ? '' : String(body);
	const p = pattern?.trim();
	if (!p) return undefined;
	try {
		const re = new RegExp(p);
		const m = re.exec(str);
		return m?.[1] ?? undefined;
	} catch {
		return undefined;
	}
}

/** Body + mod + path/key ile token değerini döndürür. bodyIsRaw true ise string body JSON parse edilmez (Raw/XML). */
function extractTokenFromBody(
	body: unknown,
	mode: string,
	pathOrKey: string,
	bodyIsRaw: boolean,
): unknown {
	const path = pathOrKey?.trim() || 'access_token';
	if (mode === 'expression') return getByExpression(body, pathOrKey);
	if (mode === 'regex') return getByRegex(body, pathOrKey);

	let parsed: unknown = body;
	// Raw/XML seçili değilse ve body string ise (JSON gibi başlıyorsa) parse dene
	if (!bodyIsRaw && typeof body === 'string' && body.trimStart().startsWith('{')) {
		try {
			parsed = JSON.parse(body);
		} catch {
			// ignore
		}
	}

	if (mode === 'findFirstKey') return findFirstKey(parsed, path);
	return getByPath(parsed, path);
}

/** Response header'dan token okur (prefix kırpılır). */
function readTokenFromHeader(
	response: { headers?: Record<string, unknown> },
	credentials: ICredentialDataDecryptedObject,
): unknown {
	const headers = response.headers ?? {};
	const headerName = ((credentials.tokenHeaderName as string) || 'authorization').toLowerCase();
	const prefix = (credentials.tokenHeaderPrefix as string) ?? 'Bearer ';
	const key = Object.keys(headers).find((k) => k.toLowerCase() === headerName);
	let value: unknown = key ? headers[key] : undefined;
	if (typeof value === 'string' && prefix && value.startsWith(prefix)) {
		value = value.slice(prefix.length);
	}
	return value;
}

export class HttpTokenApi implements ICredentialType {
	name = 'httpTokenApi';

	displayName = 'HTTP Token API';

	documentationUrl = 'httprequest';

	genericAuth = true;

	icon: Icon = 'node:n8n-nodes-base.httpRequest';

	properties: INodeProperties[] = [
		{
			displayName: 'Access Token',
			name: 'accessToken',
			type: 'hidden',
			typeOptions: {
				expirable: true,
			},
			default: '',
		},
		{
			displayName:
				'<strong>Kullanım</strong>: HTTP Request node\'da Authentication → Generic Credential Type → "HTTP Token API" seçin. Token URL\'e istek atılır, dönen cevaptan token alınır. Body: Key/Value, Raw JSON veya <strong>Raw Text</strong> (XML/SOAP). Content-Type: JSON, Form, <strong>application/xml</strong>, <strong>application/soap+xml</strong> veya Diğer. <br/><br/><strong>Yanıt JSON ise</strong>: Path veya İlk bulunan anahtar. <strong>Yanıt XML/ham metin ise</strong>: <strong>Regex</strong> (tek yakalama grubu) veya <strong>Expression</strong> (<code>body</code> = ham string).',
			name: 'usageNotice',
			type: 'notice',
			default: '',
		},
		{
			displayName: 'Token URL',
			name: 'tokenUrl',
			type: 'string',
			default: '',
			required: true,
			description: 'Token alınacak endpoint (örn. https://api.example.com/auth/token)',
		},
		{
			displayName: 'HTTP Method',
			name: 'method',
			type: 'options',
			options: [
				{
					name: 'POST',
					value: 'POST',
				},
				{
					name: 'GET',
					value: 'GET',
				},
				{
					name: 'PUT',
					value: 'PUT',
				},
				{
					name: 'PATCH',
					value: 'PATCH',
				},
			],
			default: 'POST',
		},
		{
			displayName: 'Content Type',
			name: 'contentType',
			type: 'options',
			options: [
				{
					name: 'JSON (application/json)',
					value: 'application/json',
				},
				{
					name: 'Form URL Encoded (application/x-www-form-urlencoded)',
					value: 'application/x-www-form-urlencoded',
				},
				{
					name: 'XML (application/xml)',
					value: 'application/xml',
				},
				{
					name: 'SOAP XML (application/soap+xml)',
					value: 'application/soap+xml',
				},
				{
					name: 'Diğer (özel)',
					value: 'other',
					description: 'Content-Type değerini aşağıda kendiniz yazın',
				},
			],
			default: 'application/json',
			description: 'Token isteği için gövde içerik tipi',
		},
		{
			displayName: 'Özel Content-Type',
			name: 'contentTypeCustom',
			type: 'string',
			default: '',
			placeholder: 'application/xml',
			displayOptions: {
				show: {
					contentType: ['other'],
				},
			},
			description: 'Kullanılacak Content-Type değeri (örn. application/xml, text/plain)',
		},
		{
			displayName: 'Body Mode',
			name: 'bodyMode',
			type: 'options',
			options: [
				{
					name: 'Key/Value Pairs',
					value: 'keypair',
				},
				{
					name: 'Raw JSON',
					value: 'json',
				},
				{
					name: 'Raw Text',
					value: 'rawtext',
					description: 'XML, SOAP veya herhangi bir ham metin gövdesi',
				},
			],
			default: 'keypair',
			description:
				'Token isteğinin body kısmını key/value parametreleriyle mi, ham JSON ile mi yoksa ham metin ile mi tanımlayacağınızı seçin',
		},
		{
			displayName: 'Body Parameters',
			name: 'bodyParameters',
			type: 'fixedCollection',
			typeOptions: {
				multipleValues: true,
			},
			default: {},
			displayOptions: {
				show: {
					bodyMode: ['keypair'],
				},
			},
			options: [
				{
					displayName: 'Parameters',
					name: 'parameters',
					values: [
						{
							displayName: 'Name',
							name: 'name',
							type: 'string',
							default: '',
						},
						{
							displayName: 'Value',
							name: 'value',
							type: 'string',
							default: '',
						},
					],
				},
			],
			description:
				'Username, client_id vb. için kullanılacak body parametreleri (alan adları serbest)',
		},
		{
			displayName: 'Secret Body Parameters',
			name: 'secretBodyParameters',
			type: 'fixedCollection',
			typeOptions: {
				multipleValues: true,
			},
			default: {},
			displayOptions: {
				show: {
					bodyMode: ['keypair'],
				},
			},
			options: [
				{
					displayName: 'Parameters',
					name: 'parameters',
					values: [
						{
							displayName: 'Name',
							name: 'name',
							type: 'string',
							default: '',
							placeholder: 'password',
						},
						{
							displayName: 'Value',
							name: 'value',
							type: 'string',
							typeOptions: {
								password: true,
							},
							default: '',
						},
					],
				},
			],
			description: 'Password, client_secret vb. gizli değerler (yazarken maskeleme açık)',
		},
		{
			displayName: 'JSON Body',
			name: 'jsonBody',
			type: 'json',
			default: '',
			displayOptions: {
				show: {
					bodyMode: ['json'],
				},
			},
			description:
				'Token isteği için kullanılacak ham JSON body. Geçerli JSON değilse string olarak gönderilir.',
		},
		{
			displayName: 'Raw Text Body',
			name: 'rawTextBody',
			type: 'string',
			typeOptions: {
				rows: 6,
			},
			default: '',
			displayOptions: {
				show: {
					bodyMode: ['rawtext'],
				},
			},
			description:
				'Token isteği için ham metin gövdesi (XML, SOAP, plain text vb.). Content-Type ile uyumlu seçin.',
		},
		{
			displayName: 'Token Path Mode',
			name: 'tokenPathMode',
			type: 'options',
			options: [
				{
					name: 'Path (dot & array index)',
					value: 'path',
					description:
						'Response JSON ise token alanının yolunu nokta (.) ve [indeks] ile yazın (örn. access_token, data.token).',
				},
				{
					name: 'İlk bulunan anahtar (recursive)',
					value: 'findFirstKey',
					description:
						'Response JSON ise gövdede bu isimde ilk bulunan özelliğin değerini kullanır.',
				},
				{
					name: 'Regex (raw/XML)',
					value: 'regex',
					description:
						'Yanıt XML veya ham metin ise: tek yakalama grubu olan regex ile token çıkarılır (örn. <token>([^<]+)</token>).',
				},
				{
					name: 'JavaScript expression',
					value: 'expression',
					description:
						'body = response gövdesi (string veya obje). JSON ve XML/ham metin için kullanılabilir.',
				},
			],
			default: 'path',
			description: 'JSON: Path veya İlk bulunan. XML/ham metin: Regex veya Expression kullanın.',
		},
		{
			displayName:
				'<strong>Path sözdizimi</strong>: Özellikler nokta (.) ile, dizi elemanları [sayı] ile. Dizi yoksa sadece nokta yeter (örn. <code>access_token</code>, <code>data.token</code>). Örnekler — Kök: <code>access_token</code>. İç içe: <code>data.token</code>. Dizinin ilk elemanı: <code>data.tokens[0]</code>. Dizi içinde özellik: <code>data.tokens[0].access_token</code>. İç içe dizi: <code>response.items[0].nested[0].value</code>.',
			name: 'pathModeNotice',
			type: 'notice',
			default: '',
			displayOptions: {
				show: {
					tokenPathMode: ['path'],
				},
			},
		},
		{
			displayName:
				'Response gövdesinde (obje veya dizi içinde) aranacak özellik adı. İlk bulunan eşleşmenin değeri token olarak kullanılır. Örn. <code>access_token</code>, <code>token</code>.',
			name: 'findFirstKeyNotice',
			type: 'notice',
			default: '',
			displayOptions: {
				show: {
					tokenPathMode: ['findFirstKey'],
				},
			},
		},
		{
			displayName:
				'XML/ham metin yanıtı için tek yakalama grubu olan regex. Token, ilk parantez grubundan alınır. Örn. <code>&lt;accessToken&gt;([^&lt;]+)&lt;/accessToken&gt;</code> veya <code>token=([^&amp;]+)</code>.',
			name: 'regexModeNotice',
			type: 'notice',
			default: '',
			displayOptions: {
				show: {
					tokenPathMode: ['regex'],
				},
			},
		},
		{
			displayName: 'Token Property Path / Expression / Regex',
			name: 'tokenPropertyPath',
			type: 'string',
			default: 'access_token',
			description:
				'Path: Yol (access_token, data.token). İlk bulunan: Anahtar adı. Regex: Tek yakalama grubu (örn. <token>([^<]+)</token>). Expression: body ile token döndüren ifade.',
			placeholder: 'access_token veya <token>([^<]+)</token>',
			required: true,
		},
		{
			displayName: 'Token Source',
			name: 'tokenSource',
			type: 'options',
			options: [
				{
					name: 'Body (JSON)',
					value: 'body',
					description: 'Yanıt JSON; Path veya İlk bulunan anahtar kullanın',
				},
				{
					name: 'Body (Raw/XML)',
					value: 'bodyRaw',
					description: 'Yanıt XML veya ham metin; Regex veya Expression kullanın',
				},
				{
					name: 'Header',
					value: 'header',
				},
			],
			default: 'body',
			description:
				'Token değerinin body (JSON veya Raw/XML) mi yoksa response header mı kullanılacağı',
		},
		{
			displayName: 'Token Header Name',
			name: 'tokenHeaderName',
			type: 'string',
			default: 'authorization',
			displayOptions: {
				show: {
					tokenSource: ['header'],
				},
			},
			description: 'Token bilgisini içeren header adı (örn: Authorization)',
		},
		{
			displayName: 'Token Header Prefix',
			name: 'tokenHeaderPrefix',
			type: 'string',
			default: 'Bearer ',
			displayOptions: {
				show: {
					tokenSource: ['header'],
				},
			},
			description:
				'Header değerinin başındaki prefix, varsa kırpılır (örn: "Bearer "). Boş bırakırsanız header değeri direkt token olarak alınır.',
		},
		{
			displayName: 'Authorization Prefix',
			name: 'authPrefix',
			type: 'string',
			default: 'Bearer ',
			placeholder: 'Bearer ',
			description:
				'Authorization header ön eki (varsayılan: Bearer ). JWT , ApiKey vb. yazabilirsiniz; boş bırakırsanız Bearer kullanılır.',
		},
		{
			displayName: 'Ignore SSL Issues (Insecure)',
			name: 'ignoreSSLIssues',
			type: 'boolean',
			default: false,
		},
	];

	async preAuthentication(
		this: IHttpRequestHelper,
		credentials: ICredentialDataDecryptedObject,
	): Promise<ICredentialDataDecryptedObject> {
		const tokenUrl = credentials.tokenUrl as string;
		const method = (credentials.method as IHttpRequestMethods) || 'POST';
		const contentTypeRaw = (credentials.contentType as string) || 'application/json';
		const contentType =
			contentTypeRaw === 'other' ? (credentials.contentTypeCustom as string) || '' : contentTypeRaw;
		const bodyMode = (credentials.bodyMode as string) || 'keypair';
		const ignoreSSLIssues = credentials.ignoreSSLIssues === true;
		const tokenSource = (credentials.tokenSource as string) || 'body';
		const bodyIsRaw = tokenSource === 'bodyRaw';

		const headers: Record<string, string> = {};
		if (contentType) {
			headers['Content-Type'] = contentType;
		}

		let body: GenericValue | GenericValue[] | Buffer | URLSearchParams | string | undefined;

		if (bodyMode === 'keypair') {
			const parameters =
				(
					credentials.bodyParameters as {
						parameters?: Array<{ name: string; value: string }>;
					}
				)?.parameters ?? [];
			const secretParameters =
				(
					credentials.secretBodyParameters as {
						parameters?: Array<{ name: string; value: string }>;
					}
				)?.parameters ?? [];

			const bodyObject: Record<string, string> = {};

			for (const param of parameters) {
				if (!param?.name) continue;
				bodyObject[param.name] = param.value ?? '';
			}
			for (const param of secretParameters) {
				if (!param?.name) continue;
				bodyObject[param.name] = param.value ?? '';
			}

			if (contentType === 'application/json') {
				body = bodyObject;
			} else if (contentType === 'application/x-www-form-urlencoded') {
				const params = new URLSearchParams();
				for (const [key, value] of Object.entries(bodyObject)) {
					params.append(key, value);
				}
				body = params;
			} else {
				body = bodyObject;
			}
		} else if (bodyMode === 'json') {
			const rawJson = (credentials.jsonBody as string) ?? '';

			if (rawJson) {
				try {
					body = JSON.parse(rawJson);
				} catch {
					// Geçerli JSON değilse string olarak gönder
					body = rawJson;
				}
			}
		} else if (bodyMode === 'rawtext') {
			const rawText = (credentials.rawTextBody as string) ?? '';
			if (rawText) {
				body = rawText;
			}
		}

		const response = await this.helpers.httpRequest({
			method,
			url: tokenUrl,
			body,
			headers,
			skipSslCertificateValidation: ignoreSSLIssues,
			returnFullResponse: true,
		});

		const responseTyped = response as { body?: unknown; headers?: Record<string, unknown> };
		const rawToken =
			tokenSource === 'header'
				? readTokenFromHeader(responseTyped, credentials)
				: extractTokenFromBody(
						responseTyped.body ?? response,
						(credentials.tokenPathMode as string) || 'path',
						(credentials.tokenPropertyPath as string) || 'access_token',
						bodyIsRaw,
					);

		if (rawToken == null || (typeof rawToken !== 'string' && typeof rawToken !== 'number')) {
			throw new Error('Token alınamadı. Response içinde geçerli bir token bulunamadı.');
		}

		return { accessToken: String(rawToken) };
	}

	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				Authorization: '={{ ($credentials.authPrefix || "Bearer ") + $credentials.accessToken }}',
			},
		},
	};

	test: ICredentialTestRequest = {
		request: {
			method: '={{ $credentials.method || "POST" }}' as unknown as IHttpRequestMethods,
			url: '={{ $credentials.tokenUrl }}',
			skipSslCertificateValidation: '={{ $credentials.ignoreSSLIssues }}',
			headers: {
				'Content-Type':
					'={{ (() => { const ct = $credentials.contentType === "other" ? ($credentials.contentTypeCustom || "") : ($credentials.contentType || "application/json"); return ct || "application/json"; })() }}',
				Accept: 'application/json',
			},
			body: '={{ (function(){ var mode = $credentials.bodyMode || "keypair"; if (mode === "rawtext") return $credentials.rawTextBody != null ? String($credentials.rawTextBody) : ""; if (mode === "json") { try { var j = $credentials.jsonBody; if (typeof j === "object" && j !== null) return j; var s = typeof j === "string" ? j : "{}"; return s ? JSON.parse(s) : {}; } catch (_) { return {}; } } var acc = ($credentials.bodyParameters?.parameters || []).reduce(function(a, cur) { if (cur && cur.name) a[cur.name] = cur.value != null ? cur.value : ""; return a; }, {}); ($credentials.secretBodyParameters?.parameters || []).forEach(function(cur) { if (cur && cur.name) acc[cur.name] = cur.value != null ? cur.value : ""; }); return acc; })() }}',
		},
	};
}
