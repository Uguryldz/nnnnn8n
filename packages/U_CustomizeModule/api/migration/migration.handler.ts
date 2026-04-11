import type express from 'express';

import type { MigrationRequest } from '../../../types';
import { exportDataTable, exportMigrationBundle } from './migration-export.service';
import { importDataTable, importMigrationBundle } from './migration-import.service';
import { publicApiScope } from '../../shared/middlewares/global.middleware';

function isDataTableExportBundle(body: unknown): body is MigrationRequest.DataTableImport['body'] {
	if (!body || typeof body !== 'object') return false;
	const b = body as Record<string, unknown>;
	const table = b.table as Record<string, unknown> | undefined;
	const ok: boolean =
		b.version === '1.0' &&
		typeof b.exportedAt === 'string' &&
		table != null &&
		typeof table === 'object' &&
		Array.isArray(table.columns) &&
		Array.isArray(table.rows);
	return ok;
}

function isMigrationBundle(body: unknown): body is MigrationRequest.Import['body'] {
	if (!body || typeof body !== 'object') return false;
	const b = body as Record<string, unknown>;
	return (
		b.version === '1.0' &&
		typeof b.exportedAt === 'string' &&
		Array.isArray(b.workflows) &&
		Array.isArray(b.credentials) &&
		Array.isArray(b.dataTables) &&
		Array.isArray(b.variables) &&
		Array.isArray(b.tags) &&
		Array.isArray(b.tagMappings)
	);
}

export = {
	exportMigration: [
		publicApiScope('workflow:read'),
		async (req: MigrationRequest.Export, res: express.Response): Promise<express.Response> => {
			const workflowId = req.query.workflowId;
			if (!workflowId || typeof workflowId !== 'string' || workflowId.trim() === '') {
				return res.status(400).json({
					message: 'Query parameter "workflowId" is required and must be a non-empty string.',
				});
			}

			try {
				const bundle = await exportMigrationBundle(workflowId.trim(), req.user);
				return res.json(bundle);
			} catch (error) {
				if (error && typeof error === 'object' && 'httpStatusCode' in error) {
					const err = error as { httpStatusCode: number; message?: string };
					return res.status(err.httpStatusCode).json({
						message: err.message ?? 'Not Found',
					});
				}
				throw error;
			}
		},
	],
	importMigration: [
		publicApiScope('workflow:create'),
		async (req: MigrationRequest.Import, res: express.Response): Promise<express.Response> => {
			if (!isMigrationBundle(req.body)) {
				return res.status(400).json({
					message:
						'Request body must be a valid migration bundle (version "1.0", workflows, credentials, dataTables, variables, tags, tagMappings).',
				});
			}
			const { targetProjectId, ...bundle } = req.body;
			try {
				const result = await importMigrationBundle(bundle, req.user, {
					targetProjectId,
				});
				return res.json(result);
			} catch (error) {
				if (error && typeof error === 'object' && 'httpStatusCode' in error) {
					const err = error as { httpStatusCode: number; message?: string };
					return res.status(err.httpStatusCode).json({
						message: err.message ?? 'Import failed',
					});
				}
				throw error;
			}
		},
	],
	exportDataTable: [
		publicApiScope('dataTable:read'),
		async (
			req: MigrationRequest.DataTableExport,
			res: express.Response,
		): Promise<express.Response> => {
			const dataTableId = req.query.dataTableId;
			if (!dataTableId || typeof dataTableId !== 'string' || dataTableId.trim() === '') {
				return res.status(400).json({
					message: 'Query parameter "dataTableId" is required and must be a non-empty string.',
				});
			}
			try {
				const bundle = await exportDataTable(dataTableId.trim(), req.user);
				return res.json(bundle);
			} catch (error) {
				if (error && typeof error === 'object' && 'httpStatusCode' in error) {
					const err = error as { httpStatusCode: number; message?: string };
					return res.status(err.httpStatusCode).json({
						message: err.message ?? 'Not Found',
					});
				}
				throw error;
			}
		},
	],
	importDataTable: [
		publicApiScope('dataTable:create'),
		async (
			req: MigrationRequest.DataTableImport,
			res: express.Response,
		): Promise<express.Response> => {
			if (!isDataTableExportBundle(req.body)) {
				return res.status(400).json({
					message:
						'Request body must be a valid data table export bundle (version "1.0", exportedAt, table with columns and rows).',
				});
			}
			const { targetProjectId, ...bundle } = req.body;
			try {
				const result = await importDataTable(bundle, req.user, { targetProjectId });
				return res.json(result);
			} catch (error) {
				if (error && typeof error === 'object' && 'httpStatusCode' in error) {
					const err = error as { httpStatusCode: number; message?: string };
					return res.status(err.httpStatusCode).json({
						message: err.message ?? 'Import failed',
					});
				}
				throw error;
			}
		},
	],
};
