import { Logger } from '@n8n/backend-common';
import { Service } from '@n8n/di';
import { InstanceSettings } from 'n8n-core';
import * as path from 'path';
import { mkdir } from 'node:fs/promises';
import type { SimpleGit } from 'simple-git';

import { SCPreferencesService } from './sc-preferences.service';
import { SC_DEFAULT_BRANCH } from './sc-types';

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
		const env: Record<string, string> = {};

		if (pref.connectionType === 'ssh' || !pref.connectionType) {
			try {
				const keyPath = await this.prefs.getPrivateKeyPath();
				env.GIT_SSH_COMMAND = `ssh -i "${keyPath}" -o StrictHostKeyChecking=accept-new -o UserKnownHostsFile="${path.join(this.prefs.sshFolder, 'known_hosts')}"`;
			} catch {
				this.logger.debug('No SSH key available yet');
			}
		} else if (pref.connectionType === 'https' || pref.connectionType === 'http') {
			try {
				const creds = await this.prefs.getDecryptedHttpsCreds();
				if (creds.username && creds.password) {
					const token = Buffer.from(`${creds.username}:${creds.password}`).toString('base64');
					env.GIT_CONFIG_COUNT = '1';
					env.GIT_CONFIG_KEY_0 = 'http.extraheader';
					env.GIT_CONFIG_VALUE_0 = `Authorization: Basic ${token}`;
				}
			} catch {
				this.logger.debug('No HTTPS credentials available yet');
			}
		}

		this.git = simpleGit({
			baseDir: this.repoDir,
			binary: 'git',
			maxConcurrentProcesses: 1,
		}).env(env);

		return this.git;
	}

	resetClient() {
		this.git = undefined;
	}

	async initRepo(repoUrl: string, branch: string) {
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

		await g.fetch('origin');

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
			await g.fetch('origin');
		} catch {
			/* offline ok */
		}
		const result = await g.branch(['-a']);
		return {
			branches: result.all,
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
