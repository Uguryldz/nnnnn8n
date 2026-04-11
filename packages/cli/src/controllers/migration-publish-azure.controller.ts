import { Z } from '@n8n/api-types';
import { Container } from '@n8n/di';
import { AuthenticatedRequest } from '@n8n/db';
import { Body, Post, RestController } from '@n8n/decorators';
import { z } from 'zod';
import type { MigrationBundle } from '@/public-api/v1/handlers/migration/types';
import {
	exportDataTable,
	exportMigrationBundle,
} from '@/public-api/v1/handlers/migration/migration-export.service';

import { BadRequestError } from '@/errors/response-errors/bad-request.error';
import { ServiceUnavailableError } from '@/errors/response-errors/service-unavailable.error';
import { SCGitService } from '@/modules/source-control/sc-git.service';

const SC_DATATABLES_FOLDER = 'datatables';

class PublishAzureBodyDto extends Z.class({
	workflowId: z.string().min(1),
}) {}

class PublishAzureDataTableBodyDto extends Z.class({
	dataTableId: z.string().min(1),
}) {}

function sanitizeFilename(name: string): string {
	const sanitized = name
		.trim()
		.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
		.replace(/_+/g, '_')
		.slice(0, 200);
	return sanitized || 'workflow';
}

function getRootWorkflowFromBundle(bundle: MigrationBundle): MigrationBundle['workflows'][0] {
	const root =
		bundle.workflows.find((w) => w.id === bundle.sourceWorkflowId) ?? bundle.workflows[0];
	if (!root) throw new BadRequestError('Migration bundle has no workflow.');
	return root;
}

/**
 * Build relative path under migration/ preserving project/folder structure.
 * Example: projectName "Test", folderPath "Test/subfolder" -> "Test/subfolder/workflowname.json"
 */
function getMigrationRelativePath(bundle: MigrationBundle): string {
	const root = getRootWorkflowFromBundle(bundle);
	const baseName = root.name ? sanitizeFilename(root.name) : 'workflow';
	const blobName = `${baseName}.json`;

	const folderPath = root.path?.folderPath?.trim();
	if (!folderPath) return blobName;

	const segments = folderPath
		.split('/')
		.map((s) => sanitizeFilename(s))
		.filter(Boolean);
	if (segments.length === 0) return blobName;

	return `${segments.join('/')}/${blobName}`;
}

@RestController('/migration')
export class MigrationPublishAzureController {
	@Post('/publish-azure')
	async publishToAzure(
		req: AuthenticatedRequest,
		_res: unknown,
		@Body body: PublishAzureBodyDto,
	): Promise<{ ok: true; blobName: string }> {
		const workflowId = body.workflowId.trim();

		const bundle = await exportMigrationBundle(workflowId, req.user);
		const relativePath = getMigrationRelativePath(bundle);

		try {
			const gitService = Container.get(SCGitService);
			await gitService.pushMigrationFile(
				`${req.user.firstName} ${req.user.lastName}`,
				req.user.email,
				relativePath,
				JSON.stringify(bundle, null, 2),
			);
		} catch (error) {
			if (error instanceof BadRequestError) throw error;
			const detail = error instanceof Error ? error.message : String(error);
			throw new ServiceUnavailableError(
				`Push to Azure uses the same Git connection as Push to Git. Connect source control in Settings, then try again. (${detail})`,
			);
		}

		return { ok: true, blobName: relativePath };
	}

	@Post('/publish-azure-data-table')
	async publishDataTableToAzure(
		req: AuthenticatedRequest,
		_res: unknown,
		@Body body: PublishAzureDataTableBodyDto,
	): Promise<{ ok: true; blobName: string }> {
		const dataTableId = body.dataTableId.trim();
		const bundle = await exportDataTable(dataTableId, req.user);
		const baseName = bundle.table.name ? sanitizeFilename(bundle.table.name) : 'data-table';
		const relativePath = `${SC_DATATABLES_FOLDER}/${baseName}.json`;

		try {
			const gitService = Container.get(SCGitService);
			await gitService.pushMigrationFile(
				`${req.user.firstName} ${req.user.lastName}`,
				req.user.email,
				relativePath,
				JSON.stringify(bundle, null, 2),
			);
		} catch (error) {
			if (error instanceof BadRequestError) throw error;
			const detail = error instanceof Error ? error.message : String(error);
			throw new ServiceUnavailableError(
				`Push to Azure uses the same Git connection as Push to Git. Connect source control in Settings, then try again. (${detail})`,
			);
		}

		return { ok: true, blobName: relativePath };
	}
}
