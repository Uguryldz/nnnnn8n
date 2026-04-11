import { createHash } from 'crypto';
import type {
	ICredentialDataDecryptedObject,
	ICredentialType,
	IHttpRequestHelper,
	INodeProperties,
	IAuthenticateGeneric,
	Icon,
} from 'n8n-workflow';

/** Zaman eki: saniye (2 hane) veya dakika (2 hane). */
function getTimeSuffix(mode: string): string {
	const d = new Date();
	if (mode === 'ss') return String(d.getSeconds()).padStart(2, '0');
	if (mode === 'mm') return String(d.getMinutes()).padStart(2, '0');
	return '';
}

/** secret + zaman ekinin MD5 hash'ini HEX olarak döndürür (Crypto node ile aynı mantık). */
function computeToken(secret: string, timeSuffixMode: string): string {
	const suffix = getTimeSuffix(timeSuffixMode);
	const input = secret + suffix;
	return createHash('md5').update(input, 'utf8').digest('hex');
}

export class CryptedApi implements ICredentialType {
	name = 'cryptedApi';

	displayName = 'Crypted API (MD5 Token)';

	documentationUrl = 'httprequest';

	genericAuth = true;

	icon: Icon = 'node:n8n-nodes-base.httpRequest';

	properties: INodeProperties[] = [
		{
			displayName: 'Token (hesaplanan)',
			name: 'token',
			type: 'hidden',
			default: '',
		},
		{
			displayName: '',
			name: '_refreshTrigger',
			type: 'hidden',
			typeOptions: { expirable: true },
			default: '',
		},
		{
			displayName:
				"Gizli anahtar (secret). Token = MD5(secret + zaman eki) HEX. Workflow'da açık görünmez.",
			name: 'usageNotice',
			type: 'notice',
			default: '',
		},
		{
			displayName:
				"Body / parametrelerde kullanım: HTTP Request'te Body Parameters (veya benzeri) Value alanında <code>{{ $credentials.cryptedApi.secret }}</code> yazarak secret'ı istek gövdesine ekleyebilirsiniz.",
			name: 'bodyUsageNotice',
			type: 'notice',
			default: '',
		},
		{
			displayName: 'Auth format',
			name: 'authFormat',
			type: 'options',
			options: [
				{
					name: 'Simple (prefix + token)',
					value: 'simple',
					description: 'Authorization = authPrefix + MD5(secret + zaman eki)',
				},
				{
					name: 'Kendim yazacağım (JavaScript/expression)',
					value: 'custom',
					description: "Auth değerini HTTP Request'te Header olarak kendiniz yazacaksınız",
				},
			],
			default: 'simple',
			description: 'Hazır Simple kullan veya kendi auth formatını expression ile yaz',
		},
		{
			displayName:
				"<strong>Secret'a expression içinde şu şekilde erişin:</strong> <code>$credentials.secret</code>",
			name: 'customAuthSecretNotice',
			type: 'notice',
			default: '',
			displayOptions: { show: { authFormat: ['custom'] } },
		},
		{
			displayName: 'Value',
			name: 'customAuthValue',
			type: 'string',
			typeOptions: { rows: 8 },
			default: '',
			displayOptions: { show: { authFormat: ['custom'] } },
			description:
				'Authorization header değeri. Expression kullanın; secret için <code>$credentials.secret</code> yazın. Örnek yapı aşağıda.',
			placeholder:
				'"applicationkey=" + "EMLAKKATILIM" + ",requestdate=" + DateTime.now().toISO().substring(0,19) + DateTime.now().toISO().substring(23) + ",md5hashcode=" + ($credentials.secret + DateTime.now().toISO().substring(0,19) + DateTime.now().toISO().substring(23)).hash()',
		},
		{
			displayName:
				'<strong>Örnek (auth header value yapısı):</strong><br/><code>"applicationkey=" + "EMLAKKATILIM" + ",requestdate=" + DateTime.now().toISO().substring(0,19) + DateTime.now().toISO().substring(23) + ",md5hashcode=" + ($credentials.secret + DateTime.now().toISO().substring(0,19) + DateTime.now().toISO().substring(23)).hash()</code>',
			name: 'customAuthExampleNotice',
			type: 'notice',
			default: '',
			displayOptions: { show: { authFormat: ['custom'] } },
		},
		{
			displayName: 'Secret',
			name: 'secret',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			required: true,
			description: 'MD5 hash girişinin sabit kısmı (örn. 4af15e55ebbaf53a561e003f71148018)',
		},
		{
			displayName: 'Zaman eki',
			name: 'timeSuffix',
			type: 'options',
			displayOptions: { show: { authFormat: ['simple'] } },
			options: [
				{ name: 'Yok', value: 'none', description: 'Sadece secret hashlenir' },
				{ name: 'Mevcut saniye (ss)', value: 'ss', description: 'Secret + 2 haneli saniye' },
				{ name: 'Mevcut dakika (mm)', value: 'mm', description: 'Secret + 2 haneli dakika' },
			],
			default: 'ss',
			description: 'Secret sonuna eklenen kısım; her istekte güncel hesaplanır',
		},
		{
			displayName: 'Authorization prefix',
			name: 'authPrefix',
			type: 'string',
			default: 'md5hashcode ',
			placeholder: 'md5hashcode  veya Bearer ',
			displayOptions: { show: { authFormat: ['simple'] } },
			description:
				'Header değerinin başına eklenecek (varsayılan: md5hashcode ; isterseniz sonradan değiştirebilirsiniz)',
		},
	];

	async preAuthentication(
		this: IHttpRequestHelper,
		credentials: ICredentialDataDecryptedObject,
	): Promise<ICredentialDataDecryptedObject> {
		const secret = (credentials.secret as string) ?? '';
		const timeSuffix = (credentials.timeSuffix as string) || 'ss';
		const token = computeToken(secret, timeSuffix);
		return { ...credentials, token, _refreshTrigger: '' };
	}

	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				Authorization:
					'={{ $credentials.authFormat === "custom" ? ($credentials.customAuthValue ?? "") : (($credentials.authPrefix || "") + $credentials.token) }}',
			},
		},
	};
}
