import { XMLParser } from 'fast-xml-parser';
import {
	IDataObject,
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	NodeOperationError,
} from 'n8n-workflow';

const xmlParser = new XMLParser({
	ignoreAttributes: false,
	attributeNamePrefix: '@_',
	removeNSPrefix: true,
	trimValues: true,
	parseAttributeValue: true,
	parseTagValue: true,
});

export class XmlDataParser implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'U_XML Data Parser',
		name: 'xmlDataParser',
		icon: 'file:text.svg',
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["operation"]}}',
		description: 'XML verisini parse et ve JSON formatına çevir',
		defaults: {
			name: 'U_XML Data Parser',
		},
		inputs: ['main'],
		outputs: ['main'],
		properties: [
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				options: [
					{
						name: 'Parse XML',
						value: 'parseXml',
						description: 'XML stringini parse et ve JSON formatına çevir',
						action: 'Parse XML to JSON',
					},
				],
				default: 'parseXml',
			},
			{
				displayName: 'Data Source',
				name: 'dataSource',
				type: 'options',
				options: [
					{
						name: 'Tüm Item JSON',
						value: 'wholeItem',
					},
					{
						name: 'Belirli Field',
						value: 'jsonProperty',
					},
				],
				default: 'wholeItem',
			},
			{
				displayName: 'XML Field Name',
				name: 'xmlPropertyName',
				type: 'string',
				default: 'xml',
				displayOptions: {
					show: {
						dataSource: ['jsonProperty'],
					},
				},
				description: 'XML string içeren JSON field adı',
			},
			{
				displayName: 'Output Field',
				name: 'outputPropertyName',
				type: 'string',
				default: 'parsedData',
				description: 'Parse edilmiş verinin yazılacağı JSON field',
			},
			{
				displayName: 'External Output Type',
				name: 'externalOutputType',
				type: 'options',
				options: [
					{
						name: 'Default',
						value: 'default',
					},
					{
						name: 'List',
						value: 'list',
						description:
							'Belirtilen root path altındaki veriyi liste olarak çıkar (tekli değerleri de listeye sarar)',
					},
				],
				default: 'default',
			},
			{
				displayName: 'External List Output Root Path',
				name: 'externalListOutputRootPath',
				type: 'string',
				default: '',
				displayOptions: {
					show: {
						externalOutputType: ['list'],
					},
				},
				description:
					'List olarak çıkarılacak verinin path’i (örn: Body.QueryLimitResponse.QueryLimitResult.Value)',
			},
			{
				displayName: 'XML Data Output Type',
				name: 'xmlDataOutputType',
				type: 'options',
				options: [
					{
						name: 'Single',
						value: 'single',
					},
					{
						name: 'List',
						value: 'list',
						description: 'Parse çıktısını (tekli bile olsa) liste tipinde döndür',
					},
				],
				default: 'single',
				description: 'Parse sonucunun output formatını belirler',
			},
			{
				displayName: 'Root Path',
				name: 'rootPath',
				type: 'string',
				default: 'Envelope',
				description:
					"Parse edilmiş XML içinde hangi path'ten başlanacak (örn: Envelope.Body.QueryLimitResponse.QueryLimitResult.Value)",
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnItems: INodeExecutionData[] = [];

		for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
			try {
				const operation = this.getNodeParameter('operation', itemIndex) as string;
				const dataSource = this.getNodeParameter('dataSource', itemIndex) as
					| 'wholeItem'
					| 'jsonProperty';
				const xmlPropertyName = this.getNodeParameter(
					'xmlPropertyName',
					itemIndex,
					'xml',
				) as string;
				const outputPropertyName = this.getNodeParameter(
					'outputPropertyName',
					itemIndex,
					'parsedData',
				) as string;
				const externalOutputType = this.getNodeParameter(
					'externalOutputType',
					itemIndex,
					'default',
				) as 'default' | 'list';
				const externalListOutputRootPath = this.getNodeParameter(
					'externalListOutputRootPath',
					itemIndex,
					'',
				) as string;
				const xmlDataOutputType = this.getNodeParameter(
					'xmlDataOutputType',
					itemIndex,
					'single',
				) as 'single' | 'list';
				const rootPath = this.getNodeParameter('rootPath', itemIndex, 'Envelope') as string;

				if (operation === 'parseXml') {
					let xmlString: string | undefined;

					if (dataSource === 'jsonProperty') {
						xmlString = items[itemIndex].json[xmlPropertyName] as string;
					} else {
						// Tüm item JSON'dan XML string'i bul
						const itemJson = items[itemIndex].json;
						// Önce xmlPropertyName'i dene
						if (itemJson[xmlPropertyName] && typeof itemJson[xmlPropertyName] === 'string') {
							xmlString = itemJson[xmlPropertyName] as string;
						} else {
							// Tüm field'ları kontrol et, string olan ve XML gibi görüneni bul
							for (const key of Object.keys(itemJson)) {
								const value = itemJson[key];
								if (
									typeof value === 'string' &&
									value.trim().startsWith('<') &&
									(value.includes('<?xml') || value.includes('<'))
								) {
									xmlString = value;
									break;
								}
							}
						}
					}

					if (!xmlString || typeof xmlString !== 'string') {
						throw new NodeOperationError(
							this.getNode(),
							`XML string bulunamadı. Field: ${dataSource === 'jsonProperty' ? xmlPropertyName : 'item.json'}`,
						);
					}

					// XML'i parse et
					let parsedData: unknown;
					try {
						parsedData = xmlParser.parse(xmlString) as unknown;
					} catch (error) {
						throw new NodeOperationError(
							this.getNode(),
							`XML parse edilemedi: ${error instanceof Error ? error.message : String(error)}`,
						);
					}

					// Root path varsa, o path'e git
					if (rootPath) {
						const pathParts = rootPath.split('.').filter((p) => p.length > 0);
						let current: unknown = parsedData;
						for (const part of pathParts) {
							if (!current || typeof current !== 'object') {
								throw new NodeOperationError(
									this.getNode(),
									`Root path bulunamadı: ${rootPath} (${part} bir object değil)`,
								);
							}

							// Case-insensitive key arama
							const record = current as Record<string, unknown>;
							const keys = Object.keys(record);
							const foundKey = keys.find((k) => k.toLowerCase() === part.toLowerCase());
							if (!foundKey) {
								throw new NodeOperationError(
									this.getNode(),
									`Root path bulunamadı: ${rootPath} (${part} bulunamadı, mevcut keys: ${keys.join(', ')})`,
								);
							}
							current = record[foundKey];
						}
						parsedData = current;
					}

					// External list root path (opsiyonel) - parsedData içinden listeyi çıkar
					if (externalOutputType === 'list' && externalListOutputRootPath) {
						const pathParts = externalListOutputRootPath
							.split('.')
							.filter((p) => p.length > 0);
						let current: unknown = parsedData;

						for (const part of pathParts) {
							if (!current || typeof current !== 'object') {
								throw new NodeOperationError(
									this.getNode(),
									`External list root path bulunamadı: ${externalListOutputRootPath} (${part} bir object değil)`,
								);
							}

							const record = current as Record<string, unknown>;
							const keys = Object.keys(record);
							const foundKey = keys.find((k) => k.toLowerCase() === part.toLowerCase());
							if (!foundKey) {
								throw new NodeOperationError(
									this.getNode(),
									`External list root path bulunamadı: ${externalListOutputRootPath} (${part} bulunamadı, mevcut keys: ${keys.join(', ')})`,
								);
							}
							current = record[foundKey];
						}

						parsedData = current;
					}

					if (parsedData === undefined || parsedData === null) {
						throw new NodeOperationError(
							this.getNode(),
							`Parse edilmiş veri boş. Root path: ${rootPath || '(root)'}`,
						);
					}

					// Tip dönüşümleri: list istenirse tekli sonucu listeye sar
					if (externalOutputType === 'list' || xmlDataOutputType === 'list') {
						if (!Array.isArray(parsedData)) {
							parsedData = [parsedData];
						}
					}

					// Output oluştur
					const itemJson = {
						...items[itemIndex].json,
						[outputPropertyName]: parsedData,
					} as IDataObject;

					returnItems.push({
						json: itemJson,
					});
				}
			} catch (error) {
				if (this.continueOnFail()) {
					returnItems.push({
						json: {
							error: error instanceof Error ? error.message : String(error),
						},
						pairedItem: {
							item: itemIndex,
						},
					});
					continue;
				}
				throw error;
			}
		}

		return [returnItems];
	}
}
