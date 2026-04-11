import type { AuthenticatedRequest } from '@n8n/db';

export type KeyGeneratorType = 'ed25519' | 'rsa';

export interface SCPreferences {
	connected: boolean;
	repositoryUrl: string;
	branchName: string;
	branchReadOnly: boolean;
	branchColor: string;
	publicKey?: string;
	initRepo?: boolean;
	keyGeneratorType?: KeyGeneratorType;
	connectionType?: 'ssh' | 'https';
	httpsUsername?: string;
	httpsPassword?: string;
}

export const DEFAULT_PREFS: SCPreferences = {
	connected: false,
	repositoryUrl: '',
	branchName: 'main',
	branchReadOnly: false,
	branchColor: '#5296D6',
	connectionType: 'ssh',
};

export declare namespace SCRequest {
	type UpdatePreferences = AuthenticatedRequest<{}, {}, Partial<SCPreferences>, {}>;
	type Disconnect = AuthenticatedRequest<{}, {}, { keepKeyPair?: boolean }, {}>;
	type GenerateKeyPair = AuthenticatedRequest<{}, {}, { keyGeneratorType?: KeyGeneratorType }, {}>;
	type GetStatus = AuthenticatedRequest<{}, {}, {}, { direction?: string; preferLocalVersion?: string; verbose?: string }>;
}

export const SC_PREFS_DB_KEY = 'features.sourceControl';
export const SC_SSH_KEYS_DB_KEY = 'features.sourceControl.sshKeys';
export const SC_HTTPS_CREDS_DB_KEY = 'features.sourceControl.httpsCredentials';
export const SC_GIT_KEY_COMMENT = 'n8n deploy key';
export const SC_DEFAULT_BRANCH = 'main';
