/**
 * n8n Project Migration Bundle – tek JSON dosyasında proje export formatı.
 * Bir workflowId ile tetiklenen export; o workflow, subworkflow'lar, kullanılan
 * credential'lar ve data table'ları tek dosyada toplar.
 * Hedef ortamda import ile birebir yeniden oluşturulabilir.
 */

/** Proje veya klasör yol bilgisi (import'ta dizin eşlemesi için) */
export interface MigrationPath {
	projectId: string;
	projectName: string;
	/** Klasör yolu (workflow için); data table'da boş olabilir */
	folderId?: string | null;
	/** Örn: "ProjeAdi/KlasorA/AltKlasor" */
	folderPath?: string | null;
}

/** Export edilen tek bir workflow + dizin bilgisi */
export interface MigrationWorkflowItem {
	id: string;
	name: string;
	description?: string | null;
	path: MigrationPath;
	nodes: unknown[];
	connections: unknown;
	settings?: unknown;
	versionId?: string;
	triggerCount: number;
	isArchived: boolean;
	meta?: unknown;
}

/** Credential – data alanı şifreli (DB'deki gibi); aynı N8N_ENCRYPTION_KEY ile import edilir */
export interface MigrationCredentialItem {
	id: string;
	name: string;
	type: string;
	/** Şifreli credential data – decrypt edilmeden export/import */
	data: string;
}

/** Data table kolonu */
export interface MigrationDataTableColumn {
	id: string;
	name: string;
	type: string;
	index: number;
}

/** Export edilen data table + dizin + satırlar */
export interface MigrationDataTableItem {
	id: string;
	name: string;
	path: MigrationPath;
	columns: MigrationDataTableColumn[];
	rows: Record<string, unknown>[];
	createdAt: string;
	updatedAt: string;
}

/** Instance / proje variable – workflow'larda $vars.xxx ile kullanılır */
export interface MigrationVariableItem {
	id: string;
	key: string;
	type: string;
	value: string;
	/** null = global variable */
	projectId: string | null;
	projectName?: string | null;
}

/** Tag tanımı */
export interface MigrationTagItem {
	id: string;
	name: string;
}

/** Workflow–tag eşlemesi (import'ta workflow id güncellenir) */
export interface MigrationTagMappingItem {
	workflowId: string;
	tagId: string;
}

/** Migration bundle – tek JSON dosyasının kök tipi (pin data hariç) */
export interface MigrationBundle {
	version: '1.0';
	exportedAt: string;
	sourceWorkflowId: string;
	workflows: MigrationWorkflowItem[];
	credentials: MigrationCredentialItem[];
	dataTables: MigrationDataTableItem[];
	variables: MigrationVariableItem[];
	tags: MigrationTagItem[];
	tagMappings: MigrationTagMappingItem[];
}

/** Import seçenekleri – hedef proje (name referans, aynı isimde varsa update) */
export interface MigrationImportOptions {
	/** Hedef proje ID. Verilmezse kullanıcının kişisel projesi kullanılır. */
	targetProjectId?: string;
}

/** Import sonucu – name referans ile oluşturulan/güncellenen kayıt sayıları */
export interface MigrationImportResult {
	workflowsCreated: number;
	workflowsUpdated: number;
	credentialsCreated: number;
	credentialsUpdated: number;
	dataTablesCreated: number;
	dataTablesUpdated: number;
	variablesCreated: number;
	variablesUpdated: number;
	tagsCreated: number;
	/** Import edilen kök workflow'ın yeni ID'si */
	sourceWorkflowId: string;
}

/** Tek data table export bundle – kolonlar + satırlar + path */
export interface DataTableExportBundle {
	version: '1.0';
	exportedAt: string;
	table: MigrationDataTableItem;
}

/** Data table import seçenekleri */
export interface DataTableImportOptions {
	/** Hedef proje ID. Verilmezse export'taki proje adına göre get/create. */
	targetProjectId?: string;
}

/** Data table import sonucu */
export interface DataTableImportResult {
	/** Yeni oluşturuldu mu (false = mevcut tabloya eşlendi, satır eklenmedi) */
	created: boolean;
	/** Hedef data table ID */
	dataTableId: string;
	/** Eklenen satır sayısı (sadece created=true ise > 0) */
	rowsInserted: number;
}
