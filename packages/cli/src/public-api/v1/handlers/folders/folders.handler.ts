import { CreateFolderDto } from '@n8n/api-types';
import { Container } from '@n8n/di';
import type { Response } from 'express';

import { FolderNotFoundError } from '@/errors/folder-not-found.error';
import { ForbiddenError } from '@/errors/response-errors/forbidden.error';
import { NotFoundError } from '@/errors/response-errors/not-found.error';
import { FolderService } from '@/services/folder.service';
import { ProjectService } from '@/services/project.service.ee';

import {
	apiKeyHasScopeWithGlobalScopeFallback,
	isLicensed,
} from '../../shared/middlewares/global.middleware';
import type { FolderRequest } from '../../../types';

export = {
	createFolder: [
		isLicensed('feat:folders'),
		apiKeyHasScopeWithGlobalScopeFallback({ scope: 'project:update' }),
		async (req: FolderRequest.Create, res: Response) => {
			const { projectId, folderId, name } = req.body;
			if (!projectId || typeof projectId !== 'string') {
				return res.status(400).json({ message: 'projectId is required' });
			}
			if (!name || typeof name !== 'string') {
				return res.status(400).json({ message: 'name is required' });
			}
			const projectService = Container.get(ProjectService);
			const project = await projectService.getProjectWithScope(req.user, projectId, ['folder:create']);
			if (!project) {
				throw new ForbiddenError('You do not have permission to create folders in this project.');
			}
			const folderService = Container.get(FolderService);
			const payload = CreateFolderDto.safeParse({
				name,
				parentFolderId: folderId && folderId.length > 0 ? folderId : undefined,
			});
			if (payload.error) {
				return res.status(400).json({ message: payload.error.errors[0]?.message ?? 'Invalid payload' });
			}
			try {
				const folder = await folderService.createFolder(payload.data, projectId);
				return res.status(201).json(folder);
			} catch (e) {
				if (e instanceof FolderNotFoundError) {
					throw new NotFoundError(e.message);
				}
				throw e;
			}
		},
	],
};
