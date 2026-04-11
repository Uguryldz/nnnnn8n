import type { ICredentialType, INodeProperties } from 'n8n-workflow';

export class SoapBasicAuthApi implements ICredentialType {
	name = 'soapBasicAuthApi';

	displayName = 'SOAP Basic Auth';

	documentationUrl = 'https://docs.n8n.io/integrations/credentials/basic-auth/';

	properties: INodeProperties[] = [
		{
			displayName: 'Username',
			name: 'username',
			type: 'string',
			default: '',
			required: true,
		},
		{
			displayName: 'Password',
			name: 'password',
			type: 'string',
			typeOptions: {
				password: true,
			},
			default: '',
			required: true,
		},
	];

	authenticate = {
		type: 'generic' as const,
		properties: {
			auth: {
				username: '={{$credentials.username}}',
				password: '={{$credentials.password}}',
			},
		},
	};
}
