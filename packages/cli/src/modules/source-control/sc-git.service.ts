import { Logger } from '@n8n/backend-common';
import { Service } from '@n8n/di';
import { InstanceSettings } from 'n8n-core';
import * as path from 'path';
import { mkdir } from 'node:fs/promises';
import type { SimpleGit } from 'simple-git';

import { SCPreferencesService } from './sc-preferences.service';
import { SC_DEFAULT_BRANCH, isProtectedBranch, SC_PROTECTED_BRANCHES } from './sc-types';

class ProtectedBranchError extends Error {
	constructor(branch: string) {
		super(
			`Push blocked: '${branch}' is a protected branch. Switch to another branch before publishing. (protected: ${SC_PROTECTED_BRANCHES.join(', ')})`,
		);
		this.name = 'ProtectedBranchError';
	}
}

@Service()
export class SCGitService {
	private git: SimpleGit | undefined;

	constructor(
		private readonly logger: Logger,
		private readonly instance: InstanceSettings,
		private readonly prefs: SCPreferencesService,
	) {}

	private get repoDir(): string {
		return this.prefs.gitFolder;
	}

	async ensureGit(): Promise<SimpleGit> {
		if (this.git) return this.git;
		const { simpleGit } = await import('simple-git');
		await mkdir(this.repoDir, { recursive: true });

		const pref = this.prefs.getPreferences();
		const env: Record<string, string> = { ...process.env } as Record<string, string>;
		// Always prevent git/credential helpers from blocking on a TTY prompt,
		// regardless of how creds were configured. Without this, git child can
		// hang up to the simple-git block timeout when credentials are missing
		// or rejected.
		env.GIT_TERMINAL_PROMPT = '0';
		env.GCM_INTERACTIVE = 'Never';

		if (pref.connectionType === 'ssh' || !pref.connectionType) {
			try {
				const keyPath = await this.prefs.getPrivateKeyPath();
				env.GIT_SSH_COMMAND = `ssh -i "${keyPath}" -o StrictHostKeyChecking=accept-new -o UserKnownHostsFile="${path.join(this.prefs.sshFolder, 'known_hosts')}" -o BatchMode=yes -o ConnectTimeout=15`;
			} catch (err) {
				this.logger.warn('source-control: SSH key not available', {
					error: (err as Error).message,
				});
			}
		} else if (pref.connectionType === 'https' || pref.connectionType === 'http') {
			try {
				const creds = await this.prefs.getDecryptedHttpsCreds();
				if (creds.username && creds.password) {
					const token = Buffer.from(`${creds.username}:${creds.password}`).toString('base64');
					env.GIT_CONFIG_COUNT = '1';
					env.GIT_CONFIG_KEY_0 = 'http.extraheader';
					env.GIT_CONFIG_VALUE_0 = `Authorization: Basic ${token}`;
				} else {
					this.logger.warn('source-control: HTTPS credentials are empty');
				}
			} catch (err) {
				this.logger.warn('source-control: failed to load HTTPS credentials', {
					error: (err as Error).message,
				});
			}
		}

		this.git = simpleGit({
			baseDir: this.repoDir,
			binary: 'git',
			maxConcurrentProcesses: 1,
			timeout: { block: 30_000 },
		}).env(env);

		return this.git;
	}

	resetClient() {
		this.git = undefined;
	}

	async initRepo(repoUrl: string, branch: string) {
		this.logger.info('source-control: initRepo start', { repoUrl, branch });
		const g = await this.ensureGit();
		const isRepo = await g.checkIsRepo().catch(() => false);

		if (!isRepo) {
			await g.init();
			await g.addRemote('origin', repoUrl);
		} else {
			const remotes = await g.getRemotes(true);
			const origin = remotes.find((r) => r.name === 'origin');
			if (!origin) {
				await g.addRemote('origin', repoUrl);
			} else if (origin.refs?.fetch !== repoUrl) {
				await g.remote(['set-url', 'origin', repoUrl]);
			}
		}

		try {
			await g.fetch('origin');
		} catch (err) {
			this.logger.error('source-control: fetch origin failed', {
				repoUrl,
				error: (err as Error).message,
			});
			throw err;
		}

		const targetBranch = branch || SC_DEFAULT_BRANCH;
		const branches = await g.branch();
		const localExists = branches.all.includes(targetBranch);
		const remoteExists = branches.all.includes(`remotes/origin/${targetBranch}`);

		if (localExists) {
			await g.checkout(targetBranch);
		} else if (remoteExists) {
			await g.checkout(['-b', targetBranch, `origin/${targetBranch}`]);
		} else {
			await g.checkoutLocalBranch(targetBranch);
		}
	}

	private async ensureBranch(g: SimpleGit): Promise<string> {
		const status = await g.branch();
		if (status.current && !status.detached) return status.current;
		const pref = this.prefs.getPreferences();
		const target = pref.branchName || SC_DEFAULT_BRANCH;
		try {
			await g.checkout(target);
		} catch {
			await g.checkoutLocalBranch(target);
		}
		return target;
	}

	async listBranches(): Promise<{ branches: string[]; currentBranch: string }> {
		const g = await this.ensureGit();
		try {
			// --prune drops local refs to branches that were deleted on origin.
			await g.fetch(['origin', '--prune']);
		} catch {
			/* offline ok */
		}
		const result = await g.branch(['-a']);

		// Normalize: drop the "remotes/origin/" prefix, skip the HEAD pointer,
		// and dedupe so a branch that exists both locally and remotely appears once.
		const REMOTE_PREFIX = 'remotes/origin/';
		const normalized = new Set<string>();
		for (const ref of result.all) {
			if (ref.includes('HEAD ->') || ref.endsWith('/HEAD')) continue;
			const name = ref.startsWith(REMOTE_PREFIX) ? ref.slice(REMOTE_PREFIX.length) : ref;
			if (name) normalized.add(name);
		}

		return {
			branches: Array.from(normalized).sort(),
			currentBranch: result.current,
		};
	}

	async switchBranch(branch: string) {
		const g = await this.ensureGit();
		await g.checkout(branch);
	}

	async setUserIdentity(name: string, email: string) {
		const g = await this.ensureGit();
		await g.addConfig('user.name', name, false, 'local');
		await g.addConfig('user.email', email, false, 'local');
	}

	async getStatus() {
		const g = await this.ensureGit();
		return await g.status();
	}

	async pull() {
		const g = await this.ensureGit();
		return await g.pull();
	}

	async pushWorkfolder(message: string) {
		const g = await this.ensureGit();
		const branch = await this.ensureBranch(g);
		if (isProtectedBranch(branch)) throw new ProtectedBranchError(branch);
		await g.add('.');
		const status = await g.status();
		if (status.staged.length === 0) return { statusCode: 200, pushed: false };
		await g.commit(message);
		try {
			await g.pull('origin', branch, ['--rebase']);
		} catch {
			// Remote branch may not exist yet on first push
		}
		const pushResult = await g.push('origin', branch, ['-u']);
		return { statusCode: 200, pushed: true, pushResult };
	}

	async pushMigrationFile(name: string, email: string, relativePath: string, content: string) {
		const g = await this.ensureGit();
		const branch = await this.ensureBranch(g);
		if (isProtectedBranch(branch)) throw new ProtectedBranchError(branch);
		const fs = await import('node:fs/promises');
		const pathMod = await import('node:path');

		// Pull first to avoid non-fast-forward reject on push
		try {
			await g.pull('origin', branch, ['--ff-only']);
		} catch {
			try {
				await g.pull('origin', branch, ['--rebase']);
			} catch {
				// Remote branch may not exist yet
			}
		}

		// Write under migration/ folder like the EE source control does
		const migrationPath = pathMod.join('migration', relativePath);
		const fullPath = pathMod.join(this.repoDir, migrationPath);
		await fs.mkdir(pathMod.dirname(fullPath), { recursive: true });
		await fs.writeFile(fullPath, content, 'utf8');

		await g.add(migrationPath);
		await this.setUserIdentity(name, email);
		await g.commit(`Publish migration: ${relativePath}`);
		return await g.push('origin', branch, ['-u']);
	}
}
