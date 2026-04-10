import { Logger } from '@n8n/backend-common';
import { GlobalConfig } from '@n8n/config';
import type { LdapConfig, ConnectionSecurity } from '@n8n/constants';
import { LDAP_FEATURE_NAME } from '@n8n/constants';
import type { AuthProviderSyncHistory, RunningMode, SyncStatus } from '@n8n/db';
import {
	AuthIdentity,
	AuthIdentityRepository,
	AuthProviderSyncHistoryRepository,
	GLOBAL_MEMBER_ROLE,
	isValidEmail,
	SettingsRepository,
	User,
	UserRepository,
} from '@n8n/db';
import { Constructable, Container } from '@n8n/di';
import type { IPasswordAuthHandler } from '@n8n/decorators';
import { AuthHandler } from '@n8n/decorators';
import { QueryFailedError } from '@n8n/typeorm';
import type { Entry as LdapUser, ClientOptions, Client } from 'ldapts';
import { Cipher } from 'n8n-core';
import { jsonParse, UnexpectedError } from 'n8n-workflow';
import { randomString } from 'n8n-workflow';
import type { ConnectionOptions } from 'tls';
import { validate } from 'jsonschema';
import { Filter } from 'ldapts/filters/Filter';

import { BadRequestError } from '@/errors/response-errors/bad-request.error';
import { InternalServerError } from '@/errors/response-errors/internal-server.error';
import { EventService } from '@/events/event.service';
import {
	currentAuthMethod,
	isEmailAuth,
	isLdapAuth,
	setCurrentAuthMethod,
} from './auth-method-utils';

import { BINARY_AD_ATTRIBUTES, LDAP_CONFIG_SCHEMA } from './constants';

@AuthHandler()
export class LdapService implements IPasswordAuthHandler<User> {
	readonly metadata = { name: 'ldap', type: 'password' as const };
	readonly userClass: Constructable<User> = User;

	private connection: Client | undefined;
	private ldapLib: typeof import('ldapts');
	private periodicSync: NodeJS.Timeout | undefined;
	config: LdapConfig;

	constructor(
		private readonly logger: Logger,
		private readonly settingsRepo: SettingsRepository,
		private readonly cipher: Cipher,
		private readonly events: EventService,
	) {}

	// ── Lifecycle ──────────────────────────────────────────────

	async init() {
		const cfg = await this.fetchConfig();
		try {
			await this.applyGlobalSettings(cfg);
		} catch (err) {
			this.logger.warn(
				`LDAP config init skipped – active auth method: ${currentAuthMethod()}`,
				{ error: (err as Error).message },
			);
		}
		this.applyConfig(cfg);
	}

	// ── Config persistence ─────────────────────────────────────

	async fetchConfig(): Promise<LdapConfig> {
		const row = await this.settingsRepo.findOneByOrFail({ key: LDAP_FEATURE_NAME });
		const cfg = jsonParse<LdapConfig>(row.value);
		if (cfg.enforceEmailUniqueness === undefined) cfg.enforceEmailUniqueness = true;
		cfg.bindingAdminPassword = this.cipher.decrypt(cfg.bindingAdminPassword);
		return cfg;
	}

	async persistConfig(cfg: LdapConfig): Promise<void> {
		const result = this.validateSchema(cfg);
		if (!result.ok) throw new UnexpectedError(result.detail);

		if (cfg.loginEnabled && ['saml', 'oidc'].includes(currentAuthMethod())) {
			throw new BadRequestError('LDAP cannot be enabled while another SSO method is active');
		}

		this.applyConfig({ ...cfg });

		const encrypted = { ...cfg, bindingAdminPassword: this.cipher.encrypt(cfg.bindingAdminPassword) };

		if (!encrypted.loginEnabled) {
			encrypted.synchronizationEnabled = false;
			const managed = await this.findManagedUsers();
			if (managed.length) await this.purgeAllIdentities();
		}

		await this.settingsRepo.update(
			{ key: LDAP_FEATURE_NAME },
			{ value: JSON.stringify(encrypted), loadOnStartup: true },
		);
		await this.applyGlobalSettings(cfg);
	}

	// ── Connection ─────────────────────────────────────────────

	async verifyConnection(): Promise<void> {
		await this.adminBind();
	}

	private async ensureClient() {
		if (!this.config) throw new UnexpectedError('LDAP config not loaded');
		if (this.connection) return;

		if (!this.ldapLib) this.ldapLib = await import('ldapts');

		const proto = this.config.connectionSecurity === 'tls' ? 'ldaps' : 'ldap';
		const addr = `${proto}://${this.config.connectionUrl}:${this.config.connectionPort}`;
		const opts: ClientOptions = { url: addr };
		const tls: ConnectionOptions = {};

		if (this.config.connectionSecurity !== 'none') {
			tls.rejectUnauthorized = !this.config.allowUnauthorizedCerts;
			if (this.config.connectionSecurity === 'tls') opts.tlsOptions = tls;
		}

		this.connection = new this.ldapLib.Client(opts);

		if (this.config.connectionSecurity === 'startTls') {
			await this.connection.startTLS(tls);
		}
	}

	private async adminBind() {
		await this.ensureClient();
		if (this.connection) {
			await this.connection.bind(this.config.bindingAdminDn, this.config.bindingAdminPassword);
		}
	}

	private async queryDirectory(filter: string): Promise<LdapUser[]> {
		await this.adminBind();
		if (!this.connection) return [];

		const attrs = [
			this.config.emailAttribute,
			this.config.ldapIdAttribute,
			this.config.firstNameAttribute,
			this.config.lastNameAttribute,
		];

		const { searchEntries } = await this.connection.search(this.config.baseDn, {
			attributes: attrs,
			explicitBufferAttributes: BINARY_AD_ATTRIBUTES,
			filter,
			timeLimit: this.config.searchTimeout,
			paged: this.config.searchPageSize === 0 ? true : { pageSize: this.config.searchPageSize },
		});

		await this.connection.unbind();
		return searchEntries;
	}

	private async verifyCredentials(dn: string, pwd: string) {
		await this.ensureClient();
		if (this.connection) {
			await this.connection.bind(dn, pwd);
			await this.connection.unbind();
		}
	}

	// ── Authentication ─────────────────────────────────────────

	async handleLogin(loginId: string, password: string): Promise<User | undefined> {
		if (!this.config.loginEnabled) return undefined;

		const entry = await this.authenticateRemoteUser(
			loginId,
			password,
			this.config.loginIdAttribute,
			this.config.userFilter,
		);
		if (!entry) return undefined;

		const uid = entry[this.config.ldapIdAttribute] as string;
		const attrs = {
			email: entry[this.config.emailAttribute] as string,
			firstName: entry[this.config.firstNameAttribute] as string,
			lastName: entry[this.config.lastNameAttribute] as string,
		};

		if (!uid || !attrs.email) return undefined;

		const existing = await this.findIdentity(uid);

		if (!existing) {
			if (this.config.enforceEmailUniqueness && (await this.emailHasDuplicates(attrs.email))) {
				this.logger.warn('LDAP login refused – duplicate email across LDAP entries', { email: attrs.email, uid });
				return undefined;
			}

			const localUser = await this.findUserByEmail(attrs.email);

			if (localUser?.email === attrs.email) {
				const ident = await this.linkIdentity(localUser, uid);
				await this.refreshLocalUser(ident, attrs);
			} else {
				const created = await this.provisionUser(attrs, uid);
				Container.get(EventService).emit('user-signed-up', {
					user: created,
					userType: 'ldap',
					wasDisabledLdapUser: false,
				});
				return created;
			}
		} else if (existing.user) {
			if (existing.user.disabled) return undefined;
			await this.refreshLocalUser(existing, attrs);
		}

		return (await this.findUserByLdapUid(uid)) ?? undefined;
	}

	private async authenticateRemoteUser(
		loginId: string,
		password: string,
		attr: string,
		filter: string,
	): Promise<LdapUser | undefined> {
		let results: LdapUser[] = [];
		try {
			results = await this.queryDirectory(
				this.buildFilter(`(${attr}=${this.escapeFilterValue(loginId)})`, filter),
			);
		} catch (e) {
			if (e instanceof Error) {
				this.events.emit('ldap-login-sync-failed', { error: e.message });
				this.logger.error('LDAP search error', { message: e.message });
			}
			return undefined;
		}

		if (!results.length) return undefined;

		const candidate = results.pop() ?? { dn: '' };
		try {
			await this.verifyCredentials(candidate.dn, password);
		} catch (e) {
			if (e instanceof Error) {
				this.logger.error('LDAP credential verification failed', { message: e.message });
			}
			return undefined;
		}

		this.normalizeBinaryFields(candidate);
		return candidate;
	}

	private async emailHasDuplicates(email: string): Promise<boolean> {
		try {
			const hits = await this.queryDirectory(
				this.buildFilter(
					`(${this.config.emailAttribute}=${this.escapeFilterValue(email)})`,
					this.config.userFilter,
				),
			);
			return hits.length > 1;
		} catch (err) {
			this.logger.error('LDAP duplicate-email check failed', {
				email,
				error: err instanceof Error ? err.message : 'unknown',
			});
			return true; // fail-closed
		}
	}

	// ── Synchronisation ────────────────────────────────────────

	async runSync(mode: RunningMode): Promise<void> {
		this.logger.debug(`LDAP sync starting (${mode})`);

		let remoteUsers: LdapUser[] = [];
		try {
			remoteUsers = await this.queryDirectory(
				this.buildFilter(`(${this.config.loginIdAttribute}=*)`, this.config.userFilter),
			);
			remoteUsers.forEach((u) => this.normalizeBinaryFields(u));
		} catch (e) {
			if (e instanceof Error) { this.logger.error(`LDAP sync query failed: ${e.message}`); throw e; }
		}

		const started = new Date();
		const knownIds = await this.allLocalLdapIds();

		const toCreate = this.diffNewUsers(remoteUsers, knownIds);
		const toUpdate = this.diffExistingUsers(remoteUsers, knownIds);
		const toDisable = this.diffRemovedUsers(remoteUsers, knownIds);

		const validCreates = toCreate.filter(([id, u]) => {
			if (!isValidEmail(u.email)) { this.logger.warn(`LDAP sync: invalid email for ${id}`); return false; }
			return true;
		});
		const validUpdates = toUpdate.filter(([id, u]) => {
			if (!isValidEmail(u.email)) { this.logger.warn(`LDAP sync: invalid email for ${id}`); return false; }
			return true;
		});

		this.logger.debug('LDAP sync diff', {
			create: validCreates.length,
			update: validUpdates.length,
			disable: toDisable.length,
		});

		const finished = new Date();
		let status: SyncStatus = 'success';
		let errMsg = '';

		try {
			if (mode === 'live') await this.applySyncChanges(validCreates, validUpdates, toDisable);
		} catch (e) {
			if (e instanceof QueryFailedError) { status = 'error'; errMsg = e.message; }
		}

		await this.recordSyncRun({
			startedAt: started, endedAt: finished,
			created: validCreates.length, updated: validUpdates.length,
			disabled: toDisable.length, scanned: remoteUsers.length,
			runMode: mode, status, error: errMsg,
		});

		this.events.emit('ldap-general-sync-finished', {
			type: !this.periodicSync ? 'scheduled' : `manual_${mode}`,
			succeeded: true,
			usersSynced: validCreates.length + validUpdates.length + toDisable.length,
			error: errMsg,
		});
	}

	private startPeriodicSync() {
		if (!this.config.synchronizationInterval) throw new UnexpectedError('Sync interval required');
		this.periodicSync = setInterval(
			async () => await this.runSync('live'),
			this.config.synchronizationInterval * 60_000,
		);
	}

	private cancelPeriodicSync() {
		clearInterval(this.periodicSync);
		this.periodicSync = undefined;
	}

	// ── Internal config management ─────────────────────────────

	private applyConfig(cfg: LdapConfig) {
		this.config = cfg;
		this.connection = undefined;

		if (this.periodicSync && !cfg.synchronizationEnabled) {
			this.cancelPeriodicSync();
		} else if (!this.periodicSync && cfg.synchronizationEnabled) {
			this.startPeriodicSync();
		} else if (this.periodicSync && cfg.synchronizationEnabled) {
			this.cancelPeriodicSync();
			this.startPeriodicSync();
		}
	}

	private async applyGlobalSettings(cfg: LdapConfig) {
		const current = currentAuthMethod();

		if (cfg.loginEnabled && !isEmailAuth() && !isLdapAuth()) {
			throw new InternalServerError(
				`Cannot enable LDAP while auth method "${current}" is active`,
			);
		}

		Container.get(GlobalConfig).sso.ldap.loginEnabled = cfg.loginEnabled;
		Container.get(GlobalConfig).sso.ldap.loginLabel = cfg.loginLabel;

		const target = !cfg.loginEnabled && current === 'ldap' ? 'email' : current;
		await setCurrentAuthMethod(cfg.loginEnabled ? 'ldap' : target);
	}

	// ── LDAP filter helpers ────────────────────────────────────

	private buildFilter(condition: string, userFilter: string): string {
		if (userFilter) return `(&${userFilter}${condition}`;
		return `(&(|(objectClass=person)(objectClass=user))${condition})`;
	}

	private escapeFilterValue(raw: string): string {
		// @ts-ignore – ldapts Filter.escape is a static utility
		return new Filter().escape(raw);
	}

	private normalizeBinaryFields(entry: LdapUser) {
		for (const attr of BINARY_AD_ATTRIBUTES) {
			if (entry[attr] instanceof Buffer) {
				entry[attr] = (entry[attr] as Buffer).toString('hex');
			}
		}
	}

	// ── Schema validation ──────────────────────────────────────

	private validateSchema(cfg: LdapConfig): { ok: boolean; detail: string } {
		const { valid, errors } = validate(cfg, LDAP_CONFIG_SCHEMA, { nestedErrors: true });
		if (valid) return { ok: true, detail: '' };
		return {
			ok: false,
			detail: errors.map((e) => `request.body.${e.path[0]} ${e.message}`).join(','),
		};
	}

	// ── User diff logic ────────────────────────────────────────

	private mapToLocal(entry: LdapUser, forCreation = false): [string, User] {
		const uid = entry[this.config.ldapIdAttribute] as string;
		const u = new User();
		u.email = entry[this.config.emailAttribute] as string;
		u.firstName = entry[this.config.firstNameAttribute] as string;
		u.lastName = entry[this.config.lastNameAttribute] as string;
		if (forCreation) {
			u.role = GLOBAL_MEMBER_ROLE;
			u.password = randomString(8);
			u.disabled = false;
		} else {
			u.disabled = true;
		}
		return [uid, u];
	}

	private diffNewUsers(remote: LdapUser[], localIds: string[]): Array<[string, User]> {
		return remote
			.filter((r) => !localIds.includes(r[this.config.ldapIdAttribute] as string))
			.map((r) => this.mapToLocal(r, true));
	}

	private diffExistingUsers(remote: LdapUser[], localIds: string[]): Array<[string, User]> {
		return remote
			.filter((r) => localIds.includes(r[this.config.ldapIdAttribute] as string))
			.map((r) => this.mapToLocal(r));
	}

	private diffRemovedUsers(remote: LdapUser[], localIds: string[]): string[] {
		const remoteIds = remote.map((r) => r[this.config.ldapIdAttribute]);
		return localIds.filter((id) => !remoteIds.includes(id));
	}

	// ── Database operations ────────────────────────────────────

	private async findIdentity(uid: string) {
		return await Container.get(AuthIdentityRepository).findOne({
			relations: { user: true },
			where: { providerId: uid, providerType: 'ldap' },
		});
	}

	private async findUserByLdapUid(uid: string) {
		return await Container.get(UserRepository).findOne({
			relations: { role: true },
			where: { authIdentities: { providerId: uid, providerType: 'ldap' } },
		});
	}

	private async findUserByEmail(email: string) {
		return await Container.get(UserRepository).findOne({ where: { email } });
	}

	private async allLocalLdapIds(): Promise<string[]> {
		const rows = await Container.get(AuthIdentityRepository).find({
			select: ['providerId'],
			where: { providerType: 'ldap' },
		});
		return rows.map((r) => r.providerId);
	}

	private async findManagedUsers(): Promise<User[]> {
		const rows = await Container.get(AuthIdentityRepository).find({
			relations: { user: true },
			where: { providerType: 'ldap' },
		});
		return rows.map((r) => r.user);
	}

	private async linkIdentity(user: User, uid: string) {
		return await Container.get(AuthIdentityRepository).save(
			AuthIdentity.create(user, uid),
			{ transaction: false },
		);
	}

	private async provisionUser(data: Partial<User>, uid: string) {
		const { user } = await Container.get(UserRepository).createUserWithProject({
			password: randomString(8),
			role: GLOBAL_MEMBER_ROLE,
			...data,
		});
		await this.linkIdentity(user, uid);
		return user;
	}

	private async refreshLocalUser(identity: AuthIdentity, data: Partial<User>) {
		const userId = identity?.user?.id;
		if (!userId) return;
		const user = await Container.get(UserRepository).findOneBy({ id: userId });
		if (user) {
			await Container.get(UserRepository).save({ id: userId, ...data }, { transaction: true });
		}
	}

	private async purgeAllIdentities() {
		return await Container.get(AuthIdentityRepository).delete({ providerType: 'ldap' });
	}

	private async recordSyncRun(data: Omit<AuthProviderSyncHistory, 'id' | 'providerType'>) {
		await Container.get(AuthProviderSyncHistoryRepository).save(
			{ ...data, providerType: 'ldap' },
			{ transaction: false },
		);
	}

	private async applySyncChanges(
		creates: Array<[string, User]>,
		updates: Array<[string, User]>,
		disables: string[],
	) {
		const userRepo = Container.get(UserRepository);
		await userRepo.manager.transaction(async (tx) => {
			await Promise.all([
				...creates.map(async ([uid, u]) => {
					const { user: saved } = await userRepo.createUserWithProject(u, tx);
					return await tx.save(AuthIdentity.create(saved, uid));
				}),
				...updates.map(async ([uid, u]) => {
					const ident = await tx.findOneBy(AuthIdentity, { providerId: uid });
					if (!ident?.userId) return;
					const cur = await tx.findOneBy(User, { id: ident.userId });
					if (cur && (cur.email !== u.email || cur.firstName !== u.firstName || cur.lastName !== u.lastName)) {
						Object.assign(cur, { email: u.email, firstName: u.firstName, lastName: u.lastName });
						await tx.save(User, cur);
					}
				}),
				...disables.map(async (uid) => {
					const ident = await tx.findOneBy(AuthIdentity, { providerId: uid });
					if (!ident?.userId) return;
					const u = await tx.findOneBy(User, { id: ident.userId });
					if (u) { u.disabled = true; await tx.save(u); }
					await tx.delete(AuthIdentity, { userId: ident.userId });
				}),
			]);
		});
	}

	// ── Public query for controller ────────────────────────────

	async getSyncHistory(page: number, perPage: number): Promise<AuthProviderSyncHistory[]> {
		return await Container.get(AuthProviderSyncHistoryRepository).find({
			where: { providerType: 'ldap' },
			order: { id: 'DESC' },
			take: perPage,
			skip: Math.abs(page) * perPage,
		});
	}
}
