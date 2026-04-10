import { GlobalConfig } from '@n8n/config';
import { isAuthProviderType, SettingsRepository, type AuthProviderType } from '@n8n/db';
import { Container } from '@n8n/di';

import config from '@/config';

export async function setCurrentAuthMethod(method: AuthProviderType): Promise<void> {
	config.set('userManagement.authenticationMethod', method);
	await Container.get(SettingsRepository).save(
		{ key: 'userManagement.authenticationMethod', value: method, loadOnStartup: true },
		{ transaction: false },
	);
}

export function currentAuthMethod(): AuthProviderType {
	return config.getEnv('userManagement.authenticationMethod');
}

export function isEmailAuth(): boolean {
	return currentAuthMethod() === 'email';
}

export function isLdapAuth(): boolean {
	return currentAuthMethod() === 'ldap';
}
