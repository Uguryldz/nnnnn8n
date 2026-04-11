import type { SourceControlledFile, GitCommitInfo } from '@n8n/api-types';
import { PushWorkFolderRequestDto, PullWorkFolderRequestDto } from '@n8n/api-types';
import { AuthenticatedRequest } from '@n8n/db';
import { Get, Post, Patch, RestController, GlobalScope, Body } from '@n8n/decorators';
import * as express from 'express';
import type { PullResult } from 'simple-git';

import { BadRequestError } from '@/errors/response-errors/bad-request.error';
import { EventService } from '@/events/event.service';

import { SCPreferencesService } from './sc-preferences.service';
import { SCGitService } from './sc-git.service';
import type { SCPreferences, SCRequest } from './sc-types';
import { SC_DEFAULT_BRANCH } from './sc-types';

@RestController('/source-control')
export class SourceControlController {
	constructor(
		private readonly prefsSvc: SCPreferencesService,
		private readonly gitSvc: SCGitService,
		private readonly events: EventService,
	) {}

	@Get('/preferences')
	async getPreferences(): Promise<SCPreferences> {
		const pubKey = await this.prefsSvc.getPublicKey();
		return { ...this.prefsSvc.getPreferences(), publicKey: pubKey };
	}

	@Post('/preferences')
	@GlobalScope('sourceControl:manage')
	async setPreferences(req: SCRequest.UpdatePreferences) {
		if (req.body.branchReadOnly === undefined && this.prefsSvc.isConnected()) {
			throw new BadRequestError('Disconnect first before changing preferences.');
		}
		try {
			const sanitized: Partial<SCPreferences> = {
				...req.body,
				initRepo: req.body.initRepo ?? true,
				connected: undefined,
				publicKey: undefined,
			};
			await this.prefsSvc.validatePreferences(sanitized);
			const updated = await this.prefsSvc.setPreferences(sanitized);

			if (sanitized.initRepo) {
				try {
					await this.gitSvc.initRepo(
						updated.repositoryUrl,
						updated.branchName || SC_DEFAULT_BRANCH,
					);
					await this.prefsSvc.setPreferences({ connected: true });
				} catch (err) {
					await this.disconnect({ keepKeyPair: true });
					throw err;
				}
			}

			this.gitSvc.resetClient();

			const result = this.prefsSvc.getPreferences();
			this.events.emit('source-control-settings-updated', {
				branchName: result.branchName,
				connected: result.connected,
				readOnlyInstance: result.branchReadOnly,
				repoType: 'other',
				connectionType: result.connectionType ?? 'ssh',
			});
			return result;
		} catch (e) {
			throw new BadRequestError((e as Error).message);
		}
	}

	@Patch('/preferences')
	@GlobalScope('sourceControl:manage')
	async updatePreferences(req: SCRequest.UpdatePreferences) {
		try {
			const sanitized: Partial<SCPreferences> = {
				...req.body,
				initRepo: false,
				connected: undefined,
				publicKey: undefined,
				repositoryUrl: undefined,
			};
			const current = this.prefsSvc.getPreferences();
			await this.prefsSvc.validatePreferences(sanitized);

			if (sanitized.branchName && sanitized.branchName !== current.branchName) {
				await this.gitSvc.switchBranch(sanitized.branchName);
			}
			if (sanitized.branchColor ?? sanitized.branchReadOnly !== undefined) {
				await this.prefsSvc.setPreferences({
					branchColor: sanitized.branchColor,
					branchReadOnly: sanitized.branchReadOnly,
				}, true);
			}

			this.gitSvc.resetClient();
			const result = this.prefsSvc.getPreferences();
			this.events.emit('source-control-settings-updated', {
				branchName: result.branchName,
				connected: result.connected,
				readOnlyInstance: result.branchReadOnly,
				repoType: 'other',
				connectionType: result.connectionType ?? 'ssh',
			});
			return result;
		} catch (e) {
			throw new BadRequestError((e as Error).message);
		}
	}

	@Post('/disconnect')
	@GlobalScope('sourceControl:manage')
	async disconnect(body?: { keepKeyPair?: boolean }) {
		try {
			if (!body?.keepKeyPair) {
				await this.prefsSvc.deleteKeyPair();
				await this.prefsSvc.deleteHttpsCreds();
			}
			await this.prefsSvc.setPreferences({
				connected: false,
				repositoryUrl: '',
				branchName: SC_DEFAULT_BRANCH,
				branchReadOnly: false,
			});
			this.gitSvc.resetClient();
			return { success: true };
		} catch (e) {
			throw new BadRequestError((e as Error).message);
		}
	}

	@Get('/get-branches')
	async getBranches() {
		try {
			return await this.gitSvc.listBranches();
		} catch (e) {
			throw new BadRequestError((e as Error).message);
		}
	}

	@Post('/push-workfolder')
	async pushWorkfolder(
		req: AuthenticatedRequest,
		res: express.Response,
		@Body payload: PushWorkFolderRequestDto,
	) {
		try {
			await this.gitSvc.setUserIdentity(
				`${req.user.firstName} ${req.user.lastName}`,
				req.user.email,
			);
			const result = await this.gitSvc.pushWorkfolder(
				payload.commitMessage ?? 'Updated workfolder',
			);
			res.statusCode = result.statusCode;
			return { files: [] as SourceControlledFile[], commit: null as GitCommitInfo | null };
		} catch (e) {
			throw new BadRequestError((e as Error).message);
		}
	}

	@Post('/pull-workfolder')
	@GlobalScope('sourceControl:pull')
	async pullWorkfolder(
		_req: AuthenticatedRequest,
		res: express.Response,
	): Promise<SourceControlledFile[] | PullResult | undefined> {
		try {
			const result = await this.gitSvc.pull();
			res.statusCode = 200;
			return result;
		} catch (e) {
			throw new BadRequestError((e as Error).message);
		}
	}

	@Get('/reset-workfolder')
	@GlobalScope('sourceControl:manage')
	async resetWorkfolder() {
		return { success: true };
	}

	@Get('/get-status')
	async getStatus() {
		try {
			const status = await this.gitSvc.getStatus();
			return { files: status.files ?? [] };
		} catch (e) {
			throw new BadRequestError((e as Error).message);
		}
	}

	@Get('/status')
	async status() {
		try {
			const s = await this.gitSvc.getStatus();
			return { files: s.files ?? [] };
		} catch (e) {
			throw new BadRequestError((e as Error).message);
		}
	}

	@Post('/generate-key-pair')
	@GlobalScope('sourceControl:manage')
	async generateKeyPair(req: SCRequest.GenerateKeyPair): Promise<SCPreferences> {
		try {
			const result = await this.prefsSvc.generateAndSaveKeyPair(req.body.keyGeneratorType);
			const pubKey = await this.prefsSvc.getPublicKey();
			return { ...result, publicKey: pubKey };
		} catch (e) {
			throw new BadRequestError((e as Error).message);
		}
	}
}
