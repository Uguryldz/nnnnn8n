import { createHash, createHmac } from 'crypto';
import { DateTime } from 'luxon';
import type {
	ICredentialDataDecryptedObject,
	ICredentialType,
	IHttpRequestHelper,
	INodeProperties,
	IAuthenticateGeneric,
	Icon,
} from 'n8n-workflow';

function hashHelper(input: string, algorithm: string = 'md5', encoding: string = 'hex'): string {
	return createHash(algorithm)
		.update(input, 'utf8')
		.digest(encoding as 'hex' | 'base64');
}

function hmacHelper(
	input: string,
	key: string,
	algorithm: string = 'sha256',
	encoding: string = 'hex',
): string {
	return createHmac(algorithm, key)
		.update(input, 'utf8')
		.digest(encoding as 'hex' | 'base64');
}

interface ScriptContext {
	credentials: Record<string, unknown>;
	secret: string;
	DateTime: typeof DateTime;
	hash: typeof hashHelper;
	hmac: typeof hmacHelper;
	createHash: typeof createHash;
	createHmac: typeof createHmac;
	now: () => Date;
	Buffer: typeof Buffer;
}

function evaluateAuthScript(script: string, credentials: ICredentialDataDecryptedObject): string {
	const trimmed = (script ?? '').trim();
	if (!trimmed) return '';

	// '=' ile başlıyorsa (n8n expression prefix'i) kaldır
	const body = trimmed.startsWith('=') ? trimmed.slice(1).trim() : trimmed;
	// '{{ ... }}' sarılı ise iç kısmı al
	const unwrapped = body.startsWith('{{') && body.endsWith('}}') ? body.slice(2, -2).trim() : body;

	const ctx: ScriptContext = {
		credentials: credentials as Record<string, unknown>,
		secret: (credentials.secret as string) ?? '',
		DateTime,
		hash: hashHelper,
		hmac: hmacHelper,
		createHash,
		createHmac,
		now: () => new Date(),
		Buffer,
	};

	// Body'de `return` anahtar kelimesi var mı yoksa tek-expression mı kontrol et
	const hasReturn = /(^|[^\w])return(\s|;|\()/.test(unwrapped);
	const wrappedBody = hasReturn ? unwrapped : `return (${unwrapped});`;

	try {
		// eslint-disable-next-line @typescript-eslint/no-implied-eval
		const fn = new Function(
			'credentials',
			'secret',
			'DateTime',
			'hash',
			'hmac',
			'createHash',
			'createHmac',
			'now',
			'Buffer',
			`"use strict"; ${wrappedBody}`,
		);
		const result = fn(
			ctx.credentials,
			ctx.secret,
			ctx.DateTime,
			ctx.hash,
			ctx.hmac,
			ctx.createHash,
			ctx.createHmac,
			ctx.now,
			ctx.Buffer,
		);
		if (result === null || result === undefined) return '';
		return String(result);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new Error(`Auth script evaluation failed: ${message}`);
	}
}

export class CryptedScriptApi implements ICredentialType {
	name = 'cryptedScriptApi';

	displayName = 'Crypted Script API (JS Auth)';

	documentationUrl = 'httprequest';

	genericAuth = true;

	icon: Icon = 'node:n8n-nodes-base.httpRequest';

	properties: INodeProperties[] = [
		{
			displayName: 'Computed Auth',
			name: '_computedAuth',
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
				'Bu credential, Authorization header değerini her istekte JavaScript ile hesaplar. Secret ve diğer alanlara <code>$credentials</code> olarak erişemezsiniz — bunun yerine aşağıdaki script alanında doğrudan <code>secret</code>, <code>credentials.fieldName</code>, <code>DateTime</code>, <code>hash(...)</code> kullanabilirsiniz.',
			name: 'infoNotice',
			type: 'notice',
			default: '',
		},
		{
			displayName: 'Secret',
			name: 'secret',
			type: 'string',
			typeOptions: {
				password: true,
			},
			default: '',
			required: true,
			noDataExpression: true,
			description:
				"MD5/HMAC hash girişinin sabit kısmı. Script içinde 'secret' değişkeni olarak erişebilirsiniz.",
		},
		{
			displayName: 'Extra Field 1 Name',
			name: 'extraField1Name',
			type: 'string',
			default: '',
			placeholder: 'applicationKey',
			description:
				'Opsiyonel ek alan adı. Script içinde credentials.extraField1Value olarak erişebilirsiniz.',
		},
		{
			displayName: 'Extra Field 1 Value',
			name: 'extraField1Value',
			type: 'string',
			default: '',
			noDataExpression: true,
			description: 'Opsiyonel ek alan değeri.',
		},
		{
			displayName: 'Extra Field 2 Name',
			name: 'extraField2Name',
			type: 'string',
			default: '',
			description: 'Opsiyonel ek alan adı.',
		},
		{
			displayName: 'Extra Field 2 Value',
			name: 'extraField2Value',
			type: 'string',
			typeOptions: {
				password: true,
			},
			default: '',
			noDataExpression: true,
			description: 'Opsiyonel ek alan değeri (maskelenir).',
		},
		{
			displayName: 'Auth Script (JavaScript)',
			name: 'authScript',
			type: 'string',
			typeOptions: {
				rows: 10,
			},
			default: '',
			noDataExpression: true,
			placeholder:
				'const iso = DateTime.now().toISO().substring(0,19) + DateTime.now().toISO().substring(23);\nconst md5 = hash(secret + iso, "md5");\nreturn "applicationkey=" + credentials.extraField1Value + ",requestdate=" + iso + ",md5hashcode=" + md5;',
			description:
				'Authorization header değerini döndüren JavaScript. Kullanılabilir değişkenler: <code>secret</code>, <code>credentials</code>, <code>DateTime</code> (luxon), <code>hash(input, algo?, encoding?)</code>, <code>hmac(input, key, algo?, encoding?)</code>, <code>createHash</code>, <code>createHmac</code>, <code>now()</code>, <code>Buffer</code>. Tek bir expression veya <code>return ...</code> ile biten bir blok yazabilirsiniz.',
		},
	];

	async preAuthentication(
		this: IHttpRequestHelper,
		credentials: ICredentialDataDecryptedObject,
	): Promise<ICredentialDataDecryptedObject> {
		const script = (credentials.authScript as string) ?? '';
		const computed = evaluateAuthScript(script, credentials);
		return {
			...credentials,
			_computedAuth: computed,
			_refreshTrigger: '',
		};
	}

	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				Authorization: '={{ $credentials._computedAuth || "" }}',
			},
		},
	};
}
