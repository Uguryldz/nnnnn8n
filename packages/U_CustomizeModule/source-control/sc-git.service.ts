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
		}

		try {
			await g.fetch('origin');
		} catch (e) {
			this.logger.warn('Git fetch failed during init', { error: (e as Error).message });
		}

		const targetBranch = branch || SC_DEFAULT_BRANCH;
		const branches = await g.branch();
		if (!branches.all.includes(targetBranch) && !branches.all.includes(`remotes/origin/${targetBranch}`)) {
			await g.checkoutLocalBranch(targetBranch);
		} else {
			await g.checkout(targetBranch);
		}
	}

	async listBranches(): Promise<{ branches: string[]; currentBranch: string }> {
		const g = await this.ensureGit();
		try { await g.fetch('origin'); } catch { /* offline ok */ }
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
		await g.add('.');
		const status = await g.status();
		if (status.staged.length === 0) return { statusCode: 200, pushed: false };
		await g.commit(message);
		const pushResult = await g.push('origin');
		return { statusCode: 200, pushed: true, pushResult };
	}
}
