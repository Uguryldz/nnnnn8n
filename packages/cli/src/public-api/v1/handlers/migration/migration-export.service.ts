/**
 * n8n Project Migration – Export servisi.
 * Verilen workflowId için o workflow, subworkflow'lar, kullanılan credential'lar
 * ve data table'ları toplayıp tek bir MigrationBundle JSON'u üretir.
 */

import type { User, WorkflowEntity } from '@n8n/db';
import {
	CredentialsRepository,
	FolderRepository,
	ProjectRepository,
	SharedWorkflowRepository,
	TagRepository,
	VariablesRepository,
	WorkflowRepository,
	WorkflowTagMappingRepository,
} from '@n8n/db';
import { Container } from '@n8n/di';
// eslint-disable-next-line n8n-local-rules/misplaced-n8n-typeorm-import
import { In, IsNull } from '@n8n/typeorm';
import type { INode, IConnections, IWorkflowSettings } from 'n8n-workflow';

import { NotFoundError } from '@/errors/response-errors/not-found.error';
import { DataTableColumnRepository } from '@/modules/data-table/data-table-column.repository';
import { DataTableRepository } from '@/modules/data-table/data-table.repository';
import { DataTableRowsRepository } from '@/modules/data-table/data-table-rows.repository';
import { ProjectService } from '@/services/project.service.ee';
import { WorkflowFinderService } from '@/workflows/workflow-finder.service';

import type {
	DataTableExportBundle,
	MigrationBundle,
	MigrationCredentialItem,
	MigrationDataTableItem,
	MigrationPath,
	MigrationTagItem,
	MigrationTagMappingItem,
	MigrationVariableItem,
	MigrationWorkflowItem,
} from './types';

const EXECUTE_WORKFLOW_NODE_TYPES = new Set([
	'n8n-nodes-base.executeWorkflow',
	'n8n-nodes-base.executeWorkflowTrigger',
	'@n8n/n8n-nodes-langchain.toolWorkflow',
]);

const ROWS_PAGE_SIZE = 10_000;

/** UUID (workflow vb.) veya nanoid (data table, project vb.) */
const UUID_REGEX = /^[0-9a-f-]{36}$/i;
const STRING_ID_REGEX = /^[a-zA-Z0-9_-]{5,50}$/;

function extractWorkflowIdFromNode(node: INode): string[] {
	const ids: string[] = [];
	const param = node.parameters?.workflowId;
	if (param === undefined || param === null) return ids;
	const pushId = (id: string) => {
		const s = id.trim();
		if (s && (UUID_REGEX.test(s) || STRING_ID_REGEX.test(s))) ids.push(s);
	};
	if (typeof param === 'string') {
		pushId(param);
		return ids;
	}
	// resourceLocator / workflowSelector: { __rl?, mode?, value: string }
	if (typeof param === 'object' && param !== null && 'value' in param) {
		const v = (param as { value?: unknown }).value;
		if (typeof v === 'string') pushId(v);
	}
	return ids;
}

function extractCredentialIdsFromNodes(nodes: INode[]): Set<string> {
	const ids = new Set<string>();
	for (const node of nodes) {
		const creds = node.credentials as Record<string, { id?: string }> | undefined;
		if (!creds || typeof creds !== 'object') continue;
		for (const entry of Object.values(creds)) {
			if (entry?.id) ids.add(entry.id);
		}
	}
	return ids;
}

function extractDataTableIdsFromNodes(nodes: INode[]): Set<string> {
	const ids = new Set<string>();
	for (const node of nodes) {
		const param = node.parameters?.dataTableId;
		if (param === undefined || param === null) continue;
		const pushId = (id: string) => {
			const s = id.trim();
			if (s && (UUID_REGEX.test(s) || STRING_ID_REGEX.test(s))) ids.add(s);
		};
		if (typeof param === 'string') {
			pushId(param);
			continue;
		}
		// resourceLocator: { mode?, value: string } (Data Table node)
		if (typeof param === 'object' && param !== null && 'value' in param) {
			const v = (param as { value?: unknown }).value;
			if (typeof v === 'string') pushId(v);
		}
	}
	return ids;
}

/**
 * Tek bir workflow'un nodes'ından referans edilen subworkflow id'lerini döndürür.
 */
function getReferencedWorkflowIds(workflow: { nodes: INode[] }): string[] {
	const ids: string[] = [];
	for (const node of workflow.nodes) {
		if (EXECUTE_WORKFLOW_NODE_TYPES.has(node.type)) {
			ids.push(...extractWorkflowIdFromNode(node));
		}
	}
	return ids;
}

/**
 * Tüm workflow id'lerini (ana + subworkflow'lar) recursive toplar.
 */
async function collectAllWorkflowIds(
	workflowId: string,
	user: User,
	finder: WorkflowFinderService,
): Promise<Set<string>> {
	const collected = new Set<string>();
	const queue = [workflowId];

	while (queue.length > 0) {
		const id = queue.shift()!;
		if (collected.has(id)) continue;
		collected.add(id);

		const workflow = await finder.findWorkflowForUser(id, user, ['workflow:read'], {
			includeParentFolder: false,
		});
		if (!workflow) continue;

		const refs = getReferencedWorkflowIds(workflow);
		for (const ref of refs) {
			if (!collected.has(ref)) queue.push(ref);
		}
		// settings.errorWorkflow = "hata durumunda çağrılacak workflow" id'si
		const errorWf = workflow.settings?.errorWorkflow;
		if (
			typeof errorWf === 'string' &&
			errorWf !== 'DEFAULT' &&
			(UUID_REGEX.test(errorWf.trim()) || STRING_ID_REGEX.test(errorWf.trim()))
		) {
			if (!collected.has(errorWf.trim())) queue.push(errorWf.trim());
		}
	}
	return collected;
}

/**
 * Workflow için path (project + folder) oluşturur.
 */
async function getWorkflowPath(workflow: WorkflowEntity): Promise<MigrationPath> {
	const project = await Container.get(SharedWorkflowRepository).getWorkflowOwningProject(
		workflow.id,
	);
	if (!project) {
		throw new NotFoundError(`Workflow ${workflow.id} has no owning project`);
	}

	const parentFolderId = workflow.parentFolder?.id ?? null;
	const path: MigrationPath = {
		projectId: project.id,
		projectName: project.name?.trim() || project.id || 'Personal',
		folderId: parentFolderId,
		folderPath: null,
	};

	const projectNameForPath = path.projectName;
	if (parentFolderId) {
		const folderRepository = Container.get(FolderRepository);
		const pathMap = await folderRepository.getFolderPathsToRoot([parentFolderId]);
		const segments = pathMap
			.get(parentFolderId)
			?.filter((n) => typeof n === 'string' && n.trim() !== '');
		if (segments?.length) {
			path.folderPath = [projectNameForPath, ...segments].join('/');
		}
	} else {
		path.folderPath = projectNameForPath;
	}

	return path;
}

/**
 * Data table için path (project) oluşturur.
 */
async function getDataTablePath(dataTableId: string, projectId: string): Promise<MigrationPath> {
	const project = await Container.get(ProjectRepository).findOne({
		where: { id: projectId },
		select: ['id', 'name'],
	});
	if (!project) {
		return { projectId, projectName: '' };
	}
	return {
		projectId: project.id,
		projectName: project.name?.trim() || project.id,
		folderId: null,
		folderPath: null,
	};
}

/**
 * Verilen workflowId için migration bundle üretir.
 * Kullanıcının workflow:read yetkisi ve workflow'a erişimi olmalıdır.
 */
export async function exportMigrationBundle(
	workflowId: string,
	user: User,
): Promise<MigrationBundle> {
	const finder = Container.get(WorkflowFinderService);
	const workflowRepository = Container.get(WorkflowRepository);
	const credentialsRepository = Container.get(CredentialsRepository);
	const dataTableRepository = Container.get(DataTableRepository);
	const dataTableColumnRepository = Container.get(DataTableColumnRepository);
	const dataTableRowsRepository = Container.get(DataTableRowsRepository);

	const rootWorkflow = await finder.findWorkflowForUser(workflowId, user, ['workflow:read'], {
		includeParentFolder: true,
	});
	if (!rootWorkflow) {
		throw new NotFoundError(`Workflow "${workflowId}" not found or access denied`);
	}

	const allWorkflowIds = await collectAllWorkflowIds(workflowId, user, finder);
	const workflowsWithNodes = await workflowRepository.find({
		where: { id: In([...allWorkflowIds]) },
		relations: ['parentFolder'],
	});

	const credentialIds = new Set<string>();
	const dataTableIds = new Set<string>();
	for (const w of workflowsWithNodes) {
		for (const id of extractCredentialIdsFromNodes(w.nodes)) credentialIds.add(id);
		for (const id of extractDataTableIdsFromNodes(w.nodes)) dataTableIds.add(id);
	}

	const workflowItems: MigrationWorkflowItem[] = [];
	const projectIdsForVariables = new Set<string>();
	for (const w of workflowsWithNodes) {
		const path = await getWorkflowPath(w);
		projectIdsForVariables.add(path.projectId);
		// pinData hariç – test sabit verisi export edilmez
		workflowItems.push({
			id: w.id,
			name: w.name,
			description: w.description ?? undefined,
			path,
			nodes: w.nodes as unknown[],
			connections: w.connections as unknown as IConnections,
			settings: w.settings as IWorkflowSettings | undefined,
			versionId: w.versionId ?? undefined,
			triggerCount: w.triggerCount ?? 0,
			isArchived: w.isArchived ?? false,
			meta:
				w.meta && typeof w.meta === 'object' && !Array.isArray(w.meta) ? (w.meta as object) : {},
		});
	}

	const credentialsRaw =
		credentialIds.size > 0
			? await credentialsRepository.find({ where: { id: In([...credentialIds]) } })
			: [];
	const credentials: MigrationCredentialItem[] = credentialsRaw.map((c) => ({
		id: c.id,
		name: c.name,
		type: c.type,
		data: c.data,
	}));

	const dataTables: MigrationDataTableItem[] = [];
	for (const dtId of dataTableIds) {
		try {
			const dt = await dataTableRepository.findOne({
				where: { id: dtId },
				relations: ['project', 'columns'],
			});
			if (!dt) continue;

			const projectId = dt.projectId;
			const path = await getDataTablePath(dtId, projectId);
			const columns = await dataTableColumnRepository.getColumns(dtId);

			const allRows: Record<string, unknown>[] = [];
			let skip = 0;
			let hasMore = true;
			while (hasMore) {
				const { count, data } = await dataTableRowsRepository.getManyAndCount(
					dtId,
					{ skip, take: ROWS_PAGE_SIZE },
					columns,
				);
				for (const row of data) {
					allRows.push(row as Record<string, unknown>);
				}
				skip += data.length;
				hasMore = count > skip;
			}

			dataTables.push({
				id: dt.id,
				name: dt.name,
				path,
				columns: columns.map((col) => ({
					id: col.id,
					name: col.name,
					type: col.type,
					index: col.index,
				})),
				rows: allRows,
				createdAt: dt.createdAt.toISOString(),
				updatedAt: dt.updatedAt.toISOString(),
			});
		} catch {
			// Kullanıcının bu data table'a erişimi yoksa veya bulunamazsa atla
			continue;
		}
	}

	// Variables: workflow'ların projelerine ait + global
	const variablesRepository = Container.get(VariablesRepository);
	const variablesList: MigrationVariableItem[] = [];
	try {
		const projectIdList = [...projectIdsForVariables];
		const [varsInProjects, globalVars] = await Promise.all([
			projectIdList.length > 0
				? variablesRepository.find({
						where: { project: { id: In(projectIdList) } },
						relations: ['project'],
					})
				: [],
			variablesRepository.find({
				where: { project: IsNull() },
				relations: ['project'],
			}),
		]);
		const allVars = [...varsInProjects, ...globalVars];
		for (const v of allVars) {
			variablesList.push({
				id: v.id,
				key: v.key,
				type: v.type,
				value: v.value,
				projectId: v.project?.id ?? null,
				projectName: v.project?.name ?? null,
			});
		}
	} catch {
		// Variables EE özelliği olabilir veya erişim yok; atla
	}

	// Tags: export edilen workflow'lara atanmış etiketler
	const workflowTagMappingRepository = Container.get(WorkflowTagMappingRepository);
	const tagRepository = Container.get(TagRepository);
	const tagMappings: MigrationTagMappingItem[] = [];
	let tags: MigrationTagItem[] = [];
	try {
		const mappingList = await workflowTagMappingRepository.find({
			where: { workflowId: In([...allWorkflowIds]) },
		});
		for (const m of mappingList) {
			tagMappings.push({ workflowId: m.workflowId, tagId: m.tagId });
		}
		const tagIds = [...new Set(mappingList.map((m) => m.tagId))];
		if (tagIds.length > 0) {
			const tagEntities = await tagRepository.find({ where: { id: In(tagIds) } });
			tags = tagEntities.map((t) => ({ id: t.id, name: t.name }));
		}
	} catch {
		// Tags devre dışı veya erişim yok; atla
	}

	return {
		version: '1.0',
		exportedAt: new Date().toISOString(),
		sourceWorkflowId: workflowId,
		workflows: workflowItems,
		credentials,
		dataTables,
		variables: variablesList,
		tags,
		tagMappings,
	};
}

/**
 * Tek data table'ı (kolonlar + tüm satırlar) export eder. Kullanıcının bu tablonun projesinde dataTable:read yetkisi olmalı.
 */
export async function exportDataTable(
	dataTableId: string,
	user: User,
): Promise<DataTableExportBundle> {
	const dataTableRepository = Container.get(DataTableRepository);
	const dataTableColumnRepository = Container.get(DataTableColumnRepository);
	const dataTableRowsRepository = Container.get(DataTableRowsRepository);
	const projectService = Container.get(ProjectService);

	const dt = await dataTableRepository.findOne({
		where: { id: dataTableId },
		relations: ['project'],
	});
	if (!dt) {
		throw new NotFoundError(`Data table "${dataTableId}" not found`);
	}
	const projectId = dt.projectId;
	const project = await projectService.getProjectWithScope(user, projectId, ['dataTable:read']);
	if (!project) {
		throw new NotFoundError(`Data table "${dataTableId}" not found or access denied`);
	}

	const path = await getDataTablePath(dataTableId, projectId);
	const columns = await dataTableColumnRepository.getColumns(dataTableId);
	const allRows: Record<string, unknown>[] = [];
	let skip = 0;
	let hasMore = true;
	while (hasMore) {
		const { count, data } = await dataTableRowsRepository.getManyAndCount(
			dataTableId,
			{ skip, take: ROWS_PAGE_SIZE },
			columns,
		);
		for (const row of data) {
			allRows.push(row as Record<string, unknown>);
		}
		skip += data.length;
		hasMore = count > skip;
	}

	const table: MigrationDataTableItem = {
		id: dt.id,
		name: dt.name,
		path,
		columns: columns.map((col) => ({
			id: col.id,
			name: col.name,
			type: col.type,
			index: col.index,
		})),
		rows: allRows,
		createdAt: dt.createdAt.toISOString(),
		updatedAt: dt.updatedAt.toISOString(),
	};

	return {
		version: '1.0',
		exportedAt: new Date().toISOString(),
		table,
	};
}
