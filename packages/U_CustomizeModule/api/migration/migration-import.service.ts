/**
 * n8n Project Migration – Import servisi.
 * Name-based referans: aynı isimde kayıt varsa update, yoksa create.
 * Mükerrer kayıt oluşturulmaz (workflow, credential, variable, data table, tag).
 */

import type { User } from '@n8n/db';
import {
	CredentialsEntity,
	CredentialsRepository,
	FolderRepository,
	ProjectRepository,
	SharedCredentialsRepository,
	SharedWorkflowRepository,
	TagRepository,
	VariablesRepository,
	WorkflowRepository,
	WorkflowTagMappingRepository,
} from '@n8n/db';
import { Container } from '@n8n/di';
// eslint-disable-next-line n8n-local-rules/misplaced-n8n-typeorm-import
import { In, IsNull } from '@n8n/typeorm';
import { v4 as uuid } from 'uuid';

import { CredentialsService } from '@/credentials/credentials.service';
import { addNodeIds, replaceInvalidCredentials } from '@/workflow-helpers';
import { FolderService } from '@/services/folder.service';
import { ProjectService } from '@/services/project.service.ee';
import { createWorkflowInProjectAndFolder } from '../workflows/workflows.service';
import { WorkflowHistoryService } from '@/workflows/workflow-history/workflow-history.service';
import type { WorkflowEntity } from '@n8n/db';
import type { INode } from 'n8n-workflow';

import { DataTableColumnRepository } from '@/modules/data-table/data-table-column.repository';
import { DataTableRepository } from '@/modules/data-table/data-table.repository';
import { DataTableRowsRepository } from '@/modules/data-table/data-table-rows.repository';
import type { DataTableColumnType, DataTableRows, IWorkflowBase } from 'n8n-workflow';

import type {
	DataTableExportBundle,
	DataTableImportResult,
	MigrationBundle,
	MigrationDataTableItem,
	MigrationImportResult,
	MigrationVariableItem,
	MigrationWorkflowItem,
} from './types';

const PROJECT_ROOT = '';

/**
 * folderPath = "ProjeAdi/FolderA/SubFolder" → proje adını at, "FolderA/SubFolder" segmentlerini döndür.
 */
function folderPathToSegments(
	folderPath: string | null | undefined,
	projectName: string,
): string[] {
	if (!folderPath || !folderPath.trim()) return [];
	const path = folderPath.trim();
	const withoutProject = projectName
		? path.replace(new RegExp(`^${escapeRe(projectName)}/?`), '')
		: path;
	if (!withoutProject) return [];
	return withoutProject.split('/').filter(Boolean);
}

function escapeRe(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Export'taki proje adına göre hedef proje ID döndürür: varsa bulur (yetkili olduğun proje), yoksa team projesi oluşturur.
 */
async function getOrCreateProjectByName(projectName: string, user: User): Promise<string> {
	const projectRepository = Container.get(ProjectRepository);
	const projectService = Container.get(ProjectService);
	const projects = await projectRepository.getAccessibleProjects(user.id);
	const found = projects.find((p) => p.name === projectName);
	if (found) {
		const withScope = await projectService.getProjectWithScope(user, found.id, ['workflow:create']);
		if (withScope) return withScope.id;
	}
	const created = await projectService.createTeamProject(user, { name: projectName });
	return created.id;
}

/**
 * Proje altında klasör yolunu oluşturur veya mevcut eşleşeni döndürür.
 * Aynı isimde klasör aynı parent altında tek olacak şekilde get/create.
 */
async function getOrCreateFolderByPath(
	projectId: string,
	pathSegments: string[],
	user: User,
): Promise<string | null> {
	if (pathSegments.length === 0) return null;
	const folderService = Container.get(FolderService);
	const folderRepository = Container.get(FolderRepository);

	let parentFolderId: string | null = null;
	for (const segment of pathSegments) {
		const existing = await folderRepository.findOne({
			where: {
				name: segment,
				homeProject: { id: projectId },
				parentFolderId: parentFolderId === null ? IsNull() : parentFolderId,
			},
			relations: ['homeProject'],
		});
		if (existing) {
			parentFolderId = existing.id;
			continue;
		}
		const created = await folderService.createFolder(
			{ name: segment, parentFolderId: parentFolderId ?? undefined },
			projectId,
		);
		parentFolderId = created.id;
	}
	return parentFolderId;
}

/**
 * (projectId, folderId, name) ile workflow bulur. Aynı klasörde aynı isimde tek olur.
 */
async function findWorkflowByNameInFolder(
	projectId: string,
	folderId: string | null,
	name: string,
): Promise<WorkflowEntity | null> {
	const sharedWorkflowRepository = Container.get(SharedWorkflowRepository);
	const sharedList = await sharedWorkflowRepository.find({
		where: { projectId, role: 'workflow:owner' },
		relations: ['workflow', 'workflow.parentFolder'],
	});
	const match = sharedList.find(
		(s) => s.workflow.name === name && (s.workflow.parentFolder?.id ?? null) === folderId,
	);
	return match?.workflow ?? null;
}

/**
 * Node içindeki credential id'leri eskiId -> yeniId map ile değiştirir.
 */
function replaceCredentialIdsInNodes(nodes: INode[], credentialIdMap: Map<string, string>): void {
	for (const node of nodes) {
		const creds = node.credentials as Record<string, { id?: string }> | undefined;
		if (!creds || typeof creds !== 'object') continue;
		for (const key of Object.keys(creds)) {
			const entry = creds[key];
			if (entry?.id && credentialIdMap.has(entry.id)) {
				entry.id = credentialIdMap.get(entry.id)!;
			}
		}
	}
}

/**
 * Node içindeki dataTableId (string veya resourceLocator) değerlerini map ile değiştirir.
 */
function replaceDataTableIdsInNodes(nodes: INode[], dataTableIdMap: Map<string, string>): void {
	for (const node of nodes) {
		const param = node.parameters?.dataTableId;
		if (param === undefined || param === null) continue;
		const oldId = typeof param === 'string' ? param : (param as { value?: string }).value;
		if (typeof oldId === 'string' && dataTableIdMap.has(oldId)) {
			if (typeof param === 'string') {
				node.parameters = node.parameters ?? {};
				node.parameters.dataTableId = dataTableIdMap.get(oldId)!;
			} else {
				(param as { value: string }).value = dataTableIdMap.get(oldId)!;
			}
		}
	}
}

/**
 * Execute Workflow / Tool Workflow node'larındaki workflowId'yi yeni id ile değiştirir.
 */
function replaceWorkflowIdsInNodes(nodes: INode[], workflowIdMap: Map<string, string>): void {
	const EXECUTE_TYPES = new Set([
		'n8n-nodes-base.executeWorkflow',
		'n8n-nodes-base.executeWorkflowTrigger',
		'@n8n/n8n-nodes-langchain.toolWorkflow',
	]);
	for (const node of nodes) {
		if (!EXECUTE_TYPES.has(node.type)) continue;
		const param = node.parameters?.workflowId;
		if (param === undefined || param === null) continue;
		const oldId = typeof param === 'string' ? param : (param as { value?: string }).value;
		if (typeof oldId === 'string' && workflowIdMap.has(oldId)) {
			const newId = workflowIdMap.get(oldId)!;
			if (typeof param === 'string') {
				node.parameters = node.parameters ?? {};
				node.parameters.workflowId = newId;
			} else {
				(param as { value: string }).value = newId;
			}
		}
	}
}

/**
 * settings.errorWorkflow id'sini map ile değiştirir.
 */
function replaceErrorWorkflowInSettings(
	settings: { errorWorkflow?: string } | undefined,
	workflowIdMap: Map<string, string>,
): void {
	if (!settings?.errorWorkflow || settings.errorWorkflow === 'DEFAULT') return;
	if (workflowIdMap.has(settings.errorWorkflow)) {
		settings.errorWorkflow = workflowIdMap.get(settings.errorWorkflow)!;
	}
}

export async function importMigrationBundle(
	bundle: MigrationBundle,
	user: User,
	options: { targetProjectId?: string } = {},
): Promise<MigrationImportResult> {
	const result: MigrationImportResult = {
		workflowsCreated: 0,
		workflowsUpdated: 0,
		credentialsCreated: 0,
		credentialsUpdated: 0,
		dataTablesCreated: 0,
		dataTablesUpdated: 0,
		variablesCreated: 0,
		variablesUpdated: 0,
		tagsCreated: 0,
		sourceWorkflowId: '',
	};

	const projectService = Container.get(ProjectService);
	const projectRepository = Container.get(ProjectRepository);
	const targetProject = options.targetProjectId
		? await projectService.getProjectWithScope(user, options.targetProjectId, ['workflow:create'])
		: await projectRepository.getPersonalProjectForUserOrFail(user.id);
	if (!targetProject) {
		throw new Error('Hedef proje bulunamadı veya yetkiniz yok.');
	}
	const projectId = targetProject.id;

	// Export’taki proje adları → hedef proje ID (targetProjectId verilmişse hepsi aynı projeye, yoksa ada göre get/create)
	const projectNameToId = new Map<string, string>();
	const rawNames = [
		...bundle.workflows.map((w) => w.path?.projectName),
		...bundle.dataTables.map((dt) => dt.path?.projectName),
	];
	const uniqueProjectNames = [
		...new Set(
			rawNames
				.filter((n): n is string => typeof n === 'string' && n.trim() !== '')
				.map((n) => n.trim()),
		),
	];
	if (options.targetProjectId) {
		for (const name of uniqueProjectNames) projectNameToId.set(name, projectId);
	} else {
		for (const name of uniqueProjectNames) {
			try {
				const id = await getOrCreateProjectByName(name, user);
				projectNameToId.set(name, id);
			} catch (e) {
				// Team proje kotası/lisans yoksa veya hata olursa varsayılan projeye yaz
				projectNameToId.set(name, projectId);
			}
		}
	}
	// Boş/eksik projectName → varsayılan proje; credentials/variables için de kullanılır
	projectNameToId.set('', projectId);
	const defaultProjectId = projectId;

	// 1) Variables – yoksa global olarak ekle (tüm projeler kullanabilsin), varsa dokunma
	const variablesRepository = Container.get(VariablesRepository);
	for (const v of bundle.variables) {
		const existing = await variablesRepository.findOne({
			where: { key: v.key, project: IsNull() },
			relations: ['project'],
		});
		if (!existing) {
			const created = variablesRepository.create({
				key: v.key,
				type: v.type,
				value: v.value,
				project: null,
			});
			await variablesRepository.save(created);
			result.variablesCreated++;
		}
	}

	// 2) Credentials – varsa eşleştir kullan (güncelleme yok); yoksa şema olarak oluştur (boş data, hedef ortam şifrelemesiyle – workflow çalışır, kullanıcı secret’ları sonra doldurur)
	const credentialsRepository = Container.get(CredentialsRepository);
	const sharedCredentialsRepository = Container.get(SharedCredentialsRepository);
	const credentialsService = Container.get(CredentialsService);
	const credentialIdMap = new Map<string, string>(); // bundle id -> new id
	const importProjectIds = new Set(projectNameToId.values());
	importProjectIds.add(defaultProjectId);
	for (const c of bundle.credentials) {
		const existing = await credentialsRepository.findOne({
			where: { name: c.name, type: c.type },
			relations: ['shared'],
		});
		if (existing) {
			credentialIdMap.set(c.id, existing.id);
			const sharedToImport = existing.shared?.some((s) => importProjectIds.has(s.projectId));
			if (!sharedToImport) {
				const ownerSharing = await sharedCredentialsRepository.findOne({
					where: { credentialsId: existing.id, role: 'credential:owner' },
				});
				if (!ownerSharing) {
					await sharedCredentialsRepository.save(
						sharedCredentialsRepository.create({
							credentialsId: existing.id,
							projectId: defaultProjectId,
							role: 'credential:owner',
						}),
					);
				} else {
					await sharedCredentialsRepository.save(
						sharedCredentialsRepository.create({
							credentialsId: existing.id,
							projectId: defaultProjectId,
							role: 'credential:user',
						}),
					);
				}
			}
		} else {
			// Yoksa: hedef ortamın encryption key’i ile boş data şeması oluştur; global yap ki tüm projeler kullanabilsin
			const newId = uuid();
			const encryptedData = credentialsService.createEncryptedData({
				id: newId,
				name: c.name,
				type: c.type,
				data: {},
			});
			const entity = credentialsRepository.create({
				id: newId,
				name: encryptedData.name,
				type: encryptedData.type,
				data: encryptedData.data,
				isGlobal: true,
			});
			await credentialsRepository.save(entity);
			credentialIdMap.set(c.id, entity.id);
			// Global credential’ın bir owner kaydı olmalı (sistem gereği); default projeye owner veriyoruz
			const ownerSharing = await sharedCredentialsRepository.findOne({
				where: { credentialsId: entity.id, role: 'credential:owner' },
			});
			if (!ownerSharing) {
				await sharedCredentialsRepository.save(
					sharedCredentialsRepository.create({
						credentialsId: entity.id,
						projectId: defaultProjectId,
						role: 'credential:owner',
					}),
				);
			}
			result.credentialsCreated++;
		}
	}

	// 3) Data tables – name + project (proje adına göre hedef proje)
	const dataTableRepository = Container.get(DataTableRepository);
	const dataTableColumnRepository = Container.get(DataTableColumnRepository);
	const dataTableRowsRepository = Container.get(DataTableRowsRepository);
	const dataTableIdMap = new Map<string, string>();
	for (const dt of bundle.dataTables) {
		const dtProjectId = projectNameToId.get(dt.path.projectName) ?? defaultProjectId;
		const existing = await dataTableRepository.findOne({
			where: { name: dt.name, projectId: dtProjectId },
		});
		if (existing) {
			// Update: kolonlar aynı kalabilir; satırları bundle ile güncelle
			const columns = await dataTableColumnRepository.getColumns(existing.id);
			// Mevcut satırları sil, bundle'dan ekle (basit strateji)
			// Not: DataTableRowsRepository üzerinden tüm satırları silmek için özel metod gerekebilir; şimdilik sadece id eşle
			dataTableIdMap.set(dt.id, existing.id);
			result.dataTablesUpdated++;
		} else {
			const created = await dataTableRepository.createDataTable(
				dtProjectId,
				dt.name,
				dt.columns.map((col) => ({
					name: col.name,
					type: col.type as DataTableColumnType,
					index: col.index,
				})),
			);
			dataTableIdMap.set(dt.id, created.id);
			if (dt.rows.length > 0) {
				const cols = await dataTableColumnRepository.getColumns(created.id);
				await dataTableRowsRepository.insertRows(
					created.id,
					dt.rows as DataTableRows,
					cols,
					'count',
				);
			}
			result.dataTablesCreated++;
		}
	}

	// 4) Tags – name referans
	const tagRepository = Container.get(TagRepository);
	const tagNameToId = new Map<string, string>();
	for (const t of bundle.tags) {
		let tag = await tagRepository.findOne({ where: { name: t.name } });
		if (!tag) {
			tag = tagRepository.create({ name: t.name });
			await tagRepository.save(tag);
			result.tagsCreated++;
		}
		tagNameToId.set(t.name, tag.id);
	}

	// 5) Workflows – path + name (önce tüm workflow'ları get/create, sonra workflowId referanslarını güncelle)
	const workflowIdMap = new Map<string, string>(); // bundle workflow id -> new id
	const bundleWorkflowByPath = new Map<string, MigrationWorkflowItem>(); // "projectName|folderPath|name" -> item
	for (const w of bundle.workflows) {
		const pathKey = `${w.path.projectName}|${w.path.folderPath ?? ''}|${w.name}`;
		bundleWorkflowByPath.set(pathKey, w);
	}

	for (const w of bundle.workflows) {
		const wProjectId = projectNameToId.get(w.path.projectName) ?? defaultProjectId;
		const folderPathSegments = folderPathToSegments(w.path.folderPath, w.path.projectName);
		const folderId = await getOrCreateFolderByPath(wProjectId, folderPathSegments, user);

		replaceCredentialIdsInNodes(w.nodes as INode[], credentialIdMap);
		replaceDataTableIdsInNodes(w.nodes as INode[], dataTableIdMap);
		// workflowId ve errorWorkflow henüz güncellenmeyecek (ilk geçiş)

		const existing = await findWorkflowByNameInFolder(wProjectId, folderId, w.name);
		const meta =
			w.meta && typeof w.meta === 'object' && !Array.isArray(w.meta)
				? (w.meta as WorkflowEntity['meta'])
				: {};
		const workflowPayload: Partial<WorkflowEntity> = {
			name: w.name,
			description: w.description ?? null,
			nodes: w.nodes as WorkflowEntity['nodes'],
			connections: w.connections as WorkflowEntity['connections'],
			settings: w.settings as WorkflowEntity['settings'],
			meta,
			active: false,
			isArchived: w.isArchived ?? false,
			triggerCount: w.triggerCount ?? 0,
		};
		// versionId yeni üretilir
		(workflowPayload as WorkflowEntity).versionId = uuid();

		if (existing) {
			await Container.get(WorkflowRepository).update(existing.id, {
				nodes: workflowPayload.nodes,
				connections: workflowPayload.connections,
				settings: workflowPayload.settings,
				description: workflowPayload.description,
				meta: workflowPayload.meta,
				isArchived: workflowPayload.isArchived,
				triggerCount: workflowPayload.triggerCount,
			});
			workflowIdMap.set(w.id, existing.id);
			result.workflowsUpdated++;
		} else {
			addNodeIds(workflowPayload as IWorkflowBase);
			await replaceInvalidCredentials(workflowPayload as IWorkflowBase, wProjectId);
			const created = await createWorkflowInProjectAndFolder(
				workflowPayload as WorkflowEntity,
				user,
				wProjectId,
				folderId ?? undefined,
				'workflow:owner',
			);
			workflowIdMap.set(w.id, created.id);
			result.workflowsCreated++;
		}
	}

	// 6) İkinci geçiş: workflow içindeki workflowId ve settings.errorWorkflow referanslarını güncelle
	for (const w of bundle.workflows) {
		const newId = workflowIdMap.get(w.id);
		if (!newId) continue;
		replaceWorkflowIdsInNodes(w.nodes as INode[], workflowIdMap);
		replaceErrorWorkflowInSettings(w.settings as { errorWorkflow?: string }, workflowIdMap);
		await Container.get(WorkflowRepository).update(newId, {
			nodes: w.nodes as WorkflowEntity['nodes'],
			connections: w.connections as WorkflowEntity['connections'],
			settings: w.settings as WorkflowEntity['settings'],
		});
	}

	// 7) Tag mappings – workflow id ve tag id yeni id'lere çevrilir
	const workflowTagMappingRepository = Container.get(WorkflowTagMappingRepository);
	for (const m of bundle.tagMappings) {
		const newWorkflowId = workflowIdMap.get(m.workflowId);
		const tagEntity = bundle.tags.find((t) => t.id === m.tagId);
		const newTagId = tagEntity ? tagNameToId.get(tagEntity.name) : undefined;
		if (newWorkflowId && newTagId) {
			const exists = await workflowTagMappingRepository.findOne({
				where: { workflowId: newWorkflowId, tagId: newTagId },
			});
			if (!exists) {
				await workflowTagMappingRepository.save(
					workflowTagMappingRepository.create({ workflowId: newWorkflowId, tagId: newTagId }),
				);
			}
		}
	}

	result.sourceWorkflowId = workflowIdMap.get(bundle.sourceWorkflowId) ?? '';
	return result;
}

/**
 * Tek data table export bundle'ı import eder. Name + proje: varsa sadece id döner (satır eklenmez), yoksa tablo + satırlar oluşturulur.
 */
export async function importDataTable(
	bundle: DataTableExportBundle,
	user: User,
	options: { targetProjectId?: string } = {},
): Promise<DataTableImportResult> {
	const projectService = Container.get(ProjectService);
	const projectRepository = Container.get(ProjectRepository);
	const dataTableRepository = Container.get(DataTableRepository);
	const dataTableColumnRepository = Container.get(DataTableColumnRepository);
	const dataTableRowsRepository = Container.get(DataTableRowsRepository);

	const dt = bundle.table;
	const projectName = dt.path?.projectName?.trim() || '';

	let projectId: string;
	if (options.targetProjectId) {
		const project = await projectService.getProjectWithScope(user, options.targetProjectId, [
			'dataTable:create',
		]);
		if (!project) throw new Error('Hedef proje bulunamadı veya yetkiniz yok.');
		projectId = project.id;
	} else {
		projectId = projectName
			? await getOrCreateProjectByName(projectName, user)
			: (await projectRepository.getPersonalProjectForUserOrFail(user.id)).id;
	}

	const existing = await dataTableRepository.findOne({
		where: { name: dt.name, projectId },
	});
	if (existing) {
		return { created: false, dataTableId: existing.id, rowsInserted: 0 };
	}

	const created = await dataTableRepository.createDataTable(
		projectId,
		dt.name,
		dt.columns.map((col) => ({
			name: col.name,
			type: col.type as DataTableColumnType,
			index: col.index,
		})),
	);
	let rowsInserted = 0;
	if (dt.rows.length > 0) {
		const cols = await dataTableColumnRepository.getColumns(created.id);
		await dataTableRowsRepository.insertRows(created.id, dt.rows as DataTableRows, cols, 'count');
		rowsInserted = dt.rows.length;
	}
	return { created: true, dataTableId: created.id, rowsInserted };
}
