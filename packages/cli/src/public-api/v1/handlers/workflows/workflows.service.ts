import { GlobalConfig } from '@n8n/config';
import type { User } from '@n8n/db';
import {
	SharedWorkflow,
	WorkflowEntity,
	WorkflowTagMapping,
	TagRepository,
	SharedWorkflowRepository,
	WorkflowRepository,
} from '@n8n/db';
import type { WorkflowSharingRole } from '@n8n/permissions';
import { Container } from '@n8n/di';
import { PROJECT_OWNER_ROLE_SLUG, type Scope } from '@n8n/permissions';

import { ForbiddenError } from '@/errors/response-errors/forbidden.error';
import { License } from '@/license';
import { FolderService } from '@/services/folder.service';
import { ProjectService } from '@/services/project.service.ee';
import { WorkflowCreationService } from '@/workflows/workflow-creation.service';
import { WorkflowHistoryService } from '@/workflows/workflow-history/workflow-history.service';
import { WorkflowSharingService } from '@/workflows/workflow-sharing.service';

function insertIf(condition: boolean, elements: string[]): string[] {
	return condition ? elements : [];
}

export async function getSharedWorkflowIds(
	user: User,
	scopes: Scope[],
	projectId?: string,
): Promise<string[]> {
	if (Container.get(License).isSharingEnabled()) {
		return await Container.get(WorkflowSharingService).getSharedWorkflowIds(user, {
			scopes,
			projectId,
		});
	} else {
		return await Container.get(WorkflowSharingService).getSharedWorkflowIds(user, {
			workflowRoles: ['workflow:owner'],
			projectRoles: [PROJECT_OWNER_ROLE_SLUG],
			projectId,
		});
	}
}

export async function getSharedWorkflow(
	user: User,
	workflowId?: string,
): Promise<SharedWorkflow | null> {
	return await Container.get(SharedWorkflowRepository).findOne({
		where: {
			...(!['global:owner', 'global:admin'].includes(user.role.slug) && { userId: user.id }),
			...(workflowId && { workflowId }),
		},
		relations: [
			...insertIf(!Container.get(GlobalConfig).tags.disabled, ['workflow.tags']),
			'workflow',
		],
	});
}

export async function getWorkflowById(id: string): Promise<WorkflowEntity | null> {
	return await Container.get(WorkflowRepository).findOne({
		where: { id },
	});
}

export async function createWorkflow(
	user: User,
	body: WorkflowEntity & { projectId?: string },
): Promise<WorkflowEntity> {
	const { projectId, ...rest } = body;
	const workflow = Object.assign(new WorkflowEntity(), rest);
	return await Container.get(WorkflowCreationService).createWorkflow(user, workflow, {
		projectId,
		publicApi: true,
	});
}

export async function deleteWorkflow(workflow: WorkflowEntity): Promise<WorkflowEntity> {
	return await Container.get(WorkflowRepository).remove(workflow);
}

export function parseTagNames(tags: string): string[] {
	return tags.split(',').map((tag) => tag.trim());
}

export async function getWorkflowTags(workflowId: string) {
	return await Container.get(TagRepository).find({
		select: ['id', 'name', 'createdAt', 'updatedAt'],
		where: {
			workflowMappings: {
				...(workflowId && { workflowId }),
			},
		},
	});
}

export async function updateTags(workflowId: string, newTags: string[]): Promise<void> {
	const { manager: dbManager } = Container.get(SharedWorkflowRepository);
	await dbManager.transaction(async (transactionManager) => {
		const oldTags = await transactionManager.findBy(WorkflowTagMapping, { workflowId });
		if (oldTags.length > 0) {
			await transactionManager.delete(WorkflowTagMapping, oldTags);
		}
		await transactionManager.insert(
			WorkflowTagMapping,
			newTags.map((tagId) => ({ tagId, workflowId })),
		);
	});
}

export async function createWorkflowInProjectAndFolder(
	workflow: WorkflowEntity,
	user: User,
	projectId: string,
	folderId: string | undefined,
	role: WorkflowSharingRole = 'workflow:owner',
): Promise<WorkflowEntity> {
	const projectService = Container.get(ProjectService);
	const folderService = Container.get(FolderService);
	const workflowHistoryService = Container.get(WorkflowHistoryService);
	const { manager: dbManager } = Container.get(SharedWorkflowRepository);

	const project = await projectService.getProjectWithScope(user, projectId, ['workflow:create']);
	if (!project) {
		throw new ForbiddenError('You do not have permission to create workflows in this project.');
	}
	if (folderId) {
		await folderService.findFolderInProjectOrFail(folderId, projectId);
	}

	return await dbManager.transaction(async (transactionManager) => {
		const newWorkflow = new WorkflowEntity();
		Object.assign(newWorkflow, workflow);
		const savedWorkflow = await transactionManager.save(newWorkflow);

		if (folderId) {
			const parentFolder = await folderService.findFolderInProjectOrFail(
				folderId,
				projectId,
				transactionManager,
			);
			await transactionManager.update(
				WorkflowEntity,
				{ id: savedWorkflow.id },
				{ parentFolder },
			);
		}

		const newSharedWorkflow = new SharedWorkflow();
		Object.assign(newSharedWorkflow, { role, user, project, workflow: savedWorkflow });
		await transactionManager.save(newSharedWorkflow);

		await workflowHistoryService.saveVersion(
			user,
			savedWorkflow,
			savedWorkflow.id,
			false,
			transactionManager,
		);
		return savedWorkflow;
	});
}
