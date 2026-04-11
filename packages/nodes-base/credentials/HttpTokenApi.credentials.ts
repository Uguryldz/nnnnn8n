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
			],
			default: 'application/json',
			description: 'Token isteği için gövde içerik tipi',
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
			description:
				'Password, client_secret vb. gizli değerler (yazarken maskeleme açık)',
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
				{
					name: 'Body (JSON)',
					value: 'body',
				},
				{
					name: 'Header',
					value: 'header',
				},
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
		const contentType =
			(credentials.contentType as string) || 'application/json';
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
				(credentials.bodyParameters as {
					parameters?: Array<{ name: string; value: string }>;
				})?.parameters ?? [];
			const secretParameters =
				(credentials.secretBodyParameters as {
					parameters?: Array<{ name: string; value: string }>;
				})?.parameters ?? [];

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
				Object.keys(responseHeaders).find(
					(key) => key.toLowerCase() === headerName,
				) ?? '';

			rawToken = matchedKey ? responseHeaders[matchedKey] : undefined;

			if (typeof rawToken === 'string' && tokenHeaderPrefix) {
				if (rawToken.startsWith(tokenHeaderPrefix)) {
					rawToken = rawToken.slice(tokenHeaderPrefix.length);
				}
			}
		} else {
			const tokenPropertyPath =
				(credentials.tokenPropertyPath as string) || 'access_token';
			const responseBody =
				(response as { body?: unknown }).body !== undefined
					? (response as { body?: unknown }).body
					: response;

			rawToken = getPropertyByPath(responseBody, tokenPropertyPath);
		}

		if (!rawToken || (typeof rawToken !== 'string' && typeof rawToken !== 'number')) {
			throw new Error(
				'Token alınamadı. Response içinde geçerli bir token bulunamadı.',
			);
		}

		return {
			accessToken: String(rawToken),
		};
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
			method: ('={{ $credentials.method || "POST" }}' as any) as IHttpRequestMethods,
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

