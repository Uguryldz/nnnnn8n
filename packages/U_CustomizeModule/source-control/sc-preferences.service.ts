import { Logger } from '@n8n/backend-common';
import { SettingsRepository } from '@n8n/db';
import { Service } from '@n8n/di';
import { generateKeyPairSync } from 'crypto';
import { Cipher, InstanceSettings } from 'n8n-core';
import { jsonParse, UnexpectedError } from 'n8n-workflow';
import * as path from 'path';
import { rm as fsRm } from 'fs/promises';
import { readFile, writeFile } from 'node:fs/promises';

import type { SCPreferences, KeyGeneratorType } from './sc-types';
import {
	DEFAULT_PREFS,
	SC_PREFS_DB_KEY,
	SC_SSH_KEYS_DB_KEY,
	SC_HTTPS_CREDS_DB_KEY,
	SC_GIT_KEY_COMMENT,
} from './sc-types';

type KeyPair = { publicKey: string; privateKey: string };

@Service()
export class SCPreferencesService {
	private prefs: SCPreferences = { ...DEFAULT_PREFS };
	readonly sshFolder: string;
	readonly gitFolder: string;

	constructor(
		private readonly instance: InstanceSettings,
		private readonly logger: Logger,
		private readonly cipher: Cipher,
		private readonly settingsRepo: SettingsRepository,
	) {
		this.sshFolder = path.join(instance.n8nFolder, 'ssh');
		this.gitFolder = path.join(instance.n8nFolder, 'git');
	}

	// ── Public API ─────────────────────────────────────────────

	getPreferences(): SCPreferences {
		return { ...this.prefs, connected: this.prefs.connected ?? false };
	}

	isConnected(): boolean {
		return this.prefs.connected;
	}

	isReadOnly(): boolean {
		return this.prefs.branchReadOnly;
	}

	branchName(): string {
		return this.prefs.branchName;
	}

	async getPublicKey(): Promise<string> {
		try {
			const pair = await this.loadKeyPairFromDb();
			if (pair) return pair.publicKey;
			return await readFile(path.join(this.sshFolder, 'key.pub'), { encoding: 'utf8' });
		} catch {
			return '';
		}
	}

	async validatePreferences(input: Partial<SCPreferences>): Promise<void> {
		if (input.repositoryUrl !== undefined && typeof input.repositoryUrl !== 'string') {
			throw new UnexpectedError('Invalid repositoryUrl');
		}
		if (input.branchName !== undefined && !/^[a-zA-Z0-9]/.test(input.branchName)) {
			throw new UnexpectedError('branchName must start with alphanumeric character');
		}
	}

	async setPreferences(input: Partial<SCPreferences>, persist = true): Promise<SCPreferences> {
		const noKey = (await this.loadKeyPairFromDb()) === null;
		if (noKey && (input.connectionType === 'ssh' || input.connectionType === undefined)) {
			await this.generateAndSaveKeyPair();
		}

		if (input.httpsUsername && input.httpsPassword) {
			await this.persistHttpsCreds(input.httpsUsername, input.httpsPassword);
		}

		const clean = { ...input };
		delete clean.httpsUsername;
		delete clean.httpsPassword;

		this.prefs = this.merge(clean, this.prefs);

		if (persist) {
			await this.settingsRepo.save(
				{ key: SC_PREFS_DB_KEY, value: JSON.stringify(this.prefs), loadOnStartup: true },
				{ transaction: false },
			);
		}
		return this.getPreferences();
	}

	async loadFromDb(): Promise<SCPreferences | undefined> {
		const row = await this.settingsRepo.findOne({ where: { key: SC_PREFS_DB_KEY } });
		if (row) {
			try {
				const parsed = jsonParse<SCPreferences>(row.value);
				if (parsed) {
					await this.setPreferences(parsed, false);
					return parsed;
				}
			} catch (e) {
				this.logger.warn(`Could not parse source control prefs: ${(e as Error).message}`);
			}
		}
		await this.setPreferences({ ...DEFAULT_PREFS }, true);
		return this.getPreferences();
	}

	// ── Key pair management ────────────────────────────────────

	async generateAndSaveKeyPair(type?: KeyGeneratorType): Promise<SCPreferences> {
		const algo = type ?? this.prefs.keyGeneratorType ?? 'ed25519';
		const raw = this.generateRawKeyPair(algo);

		const sshpk = await import('sshpk');
		const pub = sshpk.parseKey(raw.publicKey, 'pem');
		pub.comment = SC_GIT_KEY_COMMENT;

		const keyPair: KeyPair = {
			publicKey: pub.toString('ssh'),
			privateKey: sshpk.parsePrivateKey(raw.privateKey, 'pem').toString('ssh-private'),
		};

		await this.settingsRepo.save({
			key: SC_SSH_KEYS_DB_KEY,
			value: JSON.stringify({
				encryptedPrivateKey: this.cipher.encrypt(keyPair.privateKey),
				publicKey: keyPair.publicKey,
			}),
			loadOnStartup: true,
		});

		if (algo !== this.prefs.keyGeneratorType) {
			await this.setPreferences({ keyGeneratorType: algo });
		}

		return this.getPreferences();
	}

	async deleteKeyPair(): Promise<void> {
		try {
			await fsRm(this.sshFolder, { recursive: true });
			await this.settingsRepo.delete({ key: SC_SSH_KEYS_DB_KEY });
		} catch (e) {
			this.logger.error(`Failed to delete key pair: ${(e as Error).message}`);
		}
	}

	async getPrivateKeyPath(): Promise<string> {
		const pair = await this.loadKeyPairFromDb();
		if (!pair) throw new UnexpectedError('No key pair found');

		const decrypted = this.cipher.decrypt(pair.encryptedPrivateKey).replace(/\r\n/g, '\n');
		const tmp = path.join(this.instance.n8nFolder, 'ssh_private_key_temp');
		await fsRm(tmp, { force: true });
		await writeFile(tmp, decrypted, { mode: 0o600 });
		return tmp;
	}

	async getDecryptedHttpsCreds(): Promise<{ username: string; password: string }> {
		const row = await this.settingsRepo.findByKey(SC_HTTPS_CREDS_DB_KEY);
		if (!row?.value) throw new UnexpectedError('No HTTPS credentials found');
		const creds = jsonParse<{ encryptedUsername: string; encryptedPassword: string }>(row.value);
		return {
			username: this.cipher.decrypt(creds.encryptedUsername),
			password: this.cipher.decrypt(creds.encryptedPassword),
		};
	}

	async deleteHttpsCreds(): Promise<void> {
		await this.settingsRepo.delete({ key: SC_HTTPS_CREDS_DB_KEY });
	}

	// ── Internals ──────────────────────────────────────────────

	private async loadKeyPairFromDb() {
		const row = await this.settingsRepo.findByKey(SC_SSH_KEYS_DB_KEY);
		if (!row?.value) return null;
		return jsonParse<{ publicKey: string; encryptedPrivateKey: string } | null>(row.value, {
			fallbackValue: null,
		});
	}

	private async persistHttpsCreds(user: string, pass: string) {
		await this.settingsRepo.save({
			key: SC_HTTPS_CREDS_DB_KEY,
			value: JSON.stringify({
				encryptedUsername: this.cipher.encrypt(user),
				encryptedPassword: this.cipher.encrypt(pass),
			}),
			loadOnStartup: true,
		});
	}

	private generateRawKeyPair(algo: KeyGeneratorType): KeyPair {
		if (algo === 'ed25519') {
			return generateKeyPairSync('ed25519', {
				privateKeyEncoding: { format: 'pem', type: 'pkcs8' },
				publicKeyEncoding: { format: 'pem', type: 'spki' },
			});
		}
		return generateKeyPairSync('rsa', {
			modulusLength: 4096,
			publicKeyEncoding: { type: 'spki', format: 'pem' },
			privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
		});
	}

	private merge(input: Partial<SCPreferences>, base: SCPreferences): SCPreferences {
		return {
			connected: input.connected ?? base.connected,
			repositoryUrl: input.repositoryUrl ?? base.repositoryUrl,
			branchName: input.branchName ?? base.branchName,
			branchReadOnly: input.branchReadOnly ?? base.branchReadOnly,
			branchColor: input.branchColor ?? base.branchColor,
			keyGeneratorType: input.keyGeneratorType ?? base.keyGeneratorType,
			connectionType: input.connectionType ?? base.connectionType,
		};
	}
}
