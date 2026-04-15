import { createHash } from 'crypto';
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

function getPropertyByPath(object: unknown, path: string): unknown {
	if (!path) return object;

	const parts = path.split('.').filter((part) => part.length > 0);
	let current: unknown = object;

	for (const part of parts) {
		if (!current || typeof current !== 'object') {
			return undefined;
		}

		const record = current as Record<string, unknown>;
		if (!(part in record)) {
			return undefined;
		}

		current = record[part];
	}

	return current;
}

function stableStringify(value: unknown): string {
	if (value === null || typeof value !== 'object') {
		return JSON.stringify(value);
	}
	if (Array.isArray(value)) {
		return '[' + value.map((v) => stableStringify(v)).join(',') + ']';
	}
	const keys = Object.keys(value as Record<string, unknown>).sort();
	return (
		'{' +
		keys
			.map((k) => JSON.stringify(k) + ':' + stableStringify((value as Record<string, unknown>)[k]))
			.join(',') +
		'}'
	);
}

function computeConfigHash(credentials: ICredentialDataDecryptedObject): string {
	const relevant = {
		tokenUrl: credentials.tokenUrl,
		method: credentials.method,
		contentType: credentials.contentType,
		bodyMode: credentials.bodyMode,
		bodyParameters: credentials.bodyParameters,
		secretBodyParameters: credentials.secretBodyParameters,
		jsonBody: credentials.jsonBody,
		tokenPropertyPath: credentials.tokenPropertyPath,
		tokenSource: credentials.tokenSource,
		tokenHeaderName: credentials.tokenHeaderName,
		tokenHeaderPrefix: credentials.tokenHeaderPrefix,
		ignoreSSLIssues: credentials.ignoreSSLIssues,
	};
	return createHash('sha256').update(stableStringify(relevant), 'utf8').digest('hex');
}

export class HttpTokenRefreshApi implements ICredentialType {
	name = 'httpTokenRefreshApi';

	displayName = 'HTTP Token Refresh API';

	documentationUrl = 'httprequest';

	genericAuth = true;

	icon: Icon = 'node:n8n-nodes-base.httpRequest';

	properties: INodeProperties[] = [
		{
			displayName: 'Access Token',
			name: 'accessToken',
			type: 'hidden',
			default: '',
		},
		{
			displayName: 'Token Expires At',
			name: 'tokenExpiresAt',
			type: 'hidden',
			default: '0',
		},
		{
			displayName: 'Config Hash',
			name: 'configHash',
			type: 'hidden',
			default: '',
		},
		{
			displayName: '',
			name: '_refreshTrigger',
			type: 'hidden',
			typeOptions: {
				expirable: true,
			},
			default: '',
		},
		{
			displayName:
				"Bu credential, cache'lenmiş token'ı her yapılandırma değişikliğinde otomatik olarak yeniler. TTL dolana ya da alanlar değişene kadar aynı token yeniden kullanılır.",
			name: 'infoNotice',
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
				{ name: 'POST', value: 'POST' },
				{ name: 'GET', value: 'GET' },
				{ name: 'PUT', value: 'PUT' },
				{ name: 'PATCH', value: 'PATCH' },
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
			],
			default: 'application/json',
			description: 'Token isteği için gövde içerik tipi',
		},
		{
			displayName: 'Body Mode',
			name: 'bodyMode',
			type: 'options',
			options: [
				{ name: 'Key/Value Pairs', value: 'keypair' },
				{ name: 'Raw JSON', value: 'json' },
			],
			default: 'keypair',
			description:
				'Token isteğinin body kısmını key/value parametreleriyle mi, yoksa ham JSON ile mi tanımlayacağınızı seçin',
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
			displayName: 'Token Property Path',
			name: 'tokenPropertyPath',
			type: 'string',
			default: 'access_token',
			description:
				'Token değerinin response JSON içinde bulunduğu path (örn: access_token, data.token, result.session.id)',
			required: true,
		},
		{
			displayName: 'Token Source',
			name: 'tokenSource',
			type: 'options',
			options: [
				{ name: 'Body (JSON)', value: 'body' },
				{ name: 'Header', value: 'header' },
			],
			default: 'body',
			description: 'Token değerinin body mi yoksa response header içinden mi alınacağını seçin',
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
				'Authorization header ön eki. "Bearer ", "JWT ", "ApiKey " vb. yazabilirsiniz. Boş bırakırsanız hiçbir ön ek eklenmez; Authorization header\'ı doğrudan token değerini içerir.',
		},
		{
			displayName: 'Cache TTL (Minutes)',
			name: 'cacheTtlMinutes',
			type: 'number',
			default: 30,
			typeOptions: {
				minValue: 0,
				numberPrecision: 0,
			},
			description:
				"Alınan token'ın cache'te kaç dakika tutulacağı. 0 girerseniz her istekte yeni token alınır. Ayarlarda herhangi bir alan değişirse (tokenUrl, body params vb.) cache otomatik olarak geçersiz kılınır.",
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
		const now = Date.now();
		const cachedToken = (credentials.accessToken as string) || '';
		const cachedExpiresAt = Number(credentials.tokenExpiresAt) || 0;
		const cachedConfigHash = (credentials.configHash as string) || '';
		const ttlMinutes = Math.max(0, Number(credentials.cacheTtlMinutes ?? 30));
		const currentConfigHash = computeConfigHash(credentials);

		// Config değişmediyse ve token hâlâ TTL içindeyse cache'i yeniden kullan
		if (
			cachedToken &&
			ttlMinutes > 0 &&
			cachedConfigHash === currentConfigHash &&
			now < cachedExpiresAt
		) {
			return {
				...credentials,
				_refreshTrigger: '',
			};
		}

		// Yeni token al
		const tokenUrl = credentials.tokenUrl as string;
		const method = (credentials.method as IHttpRequestMethods) || 'POST';
		const contentType = (credentials.contentType as string) || 'application/json';
		const bodyMode = (credentials.bodyMode as string) || 'keypair';
		const ignoreSSLIssues = credentials.ignoreSSLIssues === true;
		const tokenSource = (credentials.tokenSource as string) || 'body';

		const headers: Record<string, string> = {};

		if (contentType) {
			headers['Content-Type'] = contentType;
		}

		let body: GenericValue | GenericValue[] | Buffer | URLSearchParams | undefined;

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
					body = rawJson;
				}
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

		let rawToken: unknown;

		if (tokenSource === 'header') {
			const headerName = ((credentials.tokenHeaderName as string) || 'authorization').toLowerCase();
			const tokenHeaderPrefix = (credentials.tokenHeaderPrefix as string) ?? 'Bearer ';

			const responseHeaders = (response as { headers?: Record<string, unknown> }).headers ?? {};
			const matchedKey =
				Object.keys(responseHeaders).find((key) => key.toLowerCase() === headerName) ?? '';

			rawToken = matchedKey ? responseHeaders[matchedKey] : undefined;

			if (typeof rawToken === 'string' && tokenHeaderPrefix) {
				if (rawToken.startsWith(tokenHeaderPrefix)) {
					rawToken = rawToken.slice(tokenHeaderPrefix.length);
				}
			}
		} else {
			const tokenPropertyPath = (credentials.tokenPropertyPath as string) || 'access_token';
			const responseBody =
				(response as { body?: unknown }).body !== undefined
					? (response as { body?: unknown }).body
					: response;

			rawToken = getPropertyByPath(responseBody, tokenPropertyPath);
		}

		if (!rawToken || (typeof rawToken !== 'string' && typeof rawToken !== 'number')) {
			throw new Error('Token alınamadı. Response içinde geçerli bir token bulunamadı.');
		}

		const newExpiresAt = ttlMinutes > 0 ? now + ttlMinutes * 60 * 1000 : 0;

		return {
			...credentials,
			accessToken: String(rawToken),
			tokenExpiresAt: String(newExpiresAt),
			configHash: currentConfigHash,
			_refreshTrigger: '',
		};
	}

	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				Authorization:
					'={{ $credentials.accessToken ? (($credentials.authPrefix || "") + $credentials.accessToken) : "" }}',
			},
		},
	};

	test: ICredentialTestRequest = {
		request: {
			method: '={{ $credentials.method || "POST" }}' as unknown as IHttpRequestMethods,
			url: '={{ $credentials.tokenUrl }}',
			skipSslCertificateValidation: '={{ $credentials.ignoreSSLIssues }}',
			headers: {
				'Content-Type': '={{ $credentials.contentType }}',
				Accept: 'application/json',
			},
			body: '={{ $credentials.bodyMode === "json" ? (typeof $credentials.jsonBody === "string" ? JSON.parse($credentials.jsonBody || "{}") : $credentials.jsonBody || {}) : (() => { const acc = ($credentials.bodyParameters?.parameters || []).reduce((a, cur) => { if (cur && cur.name) { a[cur.name] = cur.value != null ? cur.value : ""; } return a; }, {}); ($credentials.secretBodyParameters?.parameters || []).forEach(cur => { if (cur && cur.name) { acc[cur.name] = cur.value != null ? cur.value : ""; } }); return acc; })() }}',
		},
	};
}
