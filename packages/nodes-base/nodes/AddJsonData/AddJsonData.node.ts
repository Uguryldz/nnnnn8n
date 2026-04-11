import {
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	NodeOperationError,
} from 'n8n-workflow';

function setValueByPath(obj: any, path: string, value: any, createPath: boolean, node: any): void {
	const parts = path.split('.').filter((p) => p.length > 0);
	let current: any = obj;

	for (let i = 0; i < parts.length - 1; i++) {
		const part = parts[i];
		if (current[part] === undefined || current[part] === null) {
			if (createPath) {
				current[part] = {};
			} else {
				throw new NodeOperationError(node, `Path bulunamadı: ${parts.slice(0, i + 1).join('.')}`);
			}
		}
		current = current[part];
	}

	const lastPart = parts[parts.length - 1];
	current[lastPart] = value;
}

function parseValueByType(valueRaw: unknown, valueType: string, node: any): any {
	const valueStr = typeof valueRaw === 'string' ? valueRaw.trim() : String(valueRaw || '');

	switch (valueType) {
		case 'string':
			return valueStr;
		case 'number':
			const num = Number(valueStr);
			if (isNaN(num)) {
				throw new NodeOperationError(node, `Value geçerli bir sayı değil: ${valueStr}`);
			}
			return num;
		case 'boolean':
			const lowerStr = valueStr.toLowerCase();
			if (lowerStr === 'true' || lowerStr === '1' || lowerStr === 'yes') {
				return true;
			} else if (lowerStr === 'false' || lowerStr === '0' || lowerStr === 'no') {
				return false;
			} else {
				throw new NodeOperationError(
					node,
					`Value geçerli bir boolean değil: ${valueStr} (true/false bekleniyor)`,
				);
			}
		case 'object':
			try {
				const parsed = JSON.parse(valueStr);
				if (typeof parsed !== 'object' || Array.isArray(parsed)) {
					throw new NodeOperationError(
						node,
						'Value geçerli bir object değil (array değil, object olmalı)',
					);
				}
				return parsed;
			} catch (error) {
				throw new NodeOperationError(
					node,
					`Value geçerli bir JSON object değil: ${error instanceof Error ? error.message : String(error)}`,
				);
			}
		case 'array':
			try {
				const parsed = JSON.parse(valueStr);
				if (!Array.isArray(parsed)) {
					throw new NodeOperationError(node, 'Value geçerli bir array değil');
				}
				return parsed;
			} catch (error) {
				throw new NodeOperationError(
					node,
					`Value geçerli bir JSON array değil: ${error instanceof Error ? error.message : String(error)}`,
				);
			}
		default:
			return valueStr;
	}
}

function addFieldToArrayItems(
	obj: any,
	path: string | any,
	fieldName: string,
	fieldValue: any,
	node: any,
): void {
	// Path'i string'e çevir
	let pathStr: string;
	if (typeof path === 'string') {
		pathStr = path.trim();
	} else if (path !== null && path !== undefined) {
		pathStr = String(path).trim();
	} else {
		throw new NodeOperationError(node, 'Path boş olamaz');
	}

	if (!pathStr || pathStr === '') {
		throw new NodeOperationError(node, 'Path boş olamaz');
	}

	const parts = pathStr.split('.').filter((p) => p.length > 0);
	let current: any = obj;

	for (let i = 0; i < parts.length; i++) {
		const part = parts[i];
		if (current === null || current === undefined) {
			throw new NodeOperationError(
				node,
				`Path bulunamadı: ${parts.slice(0, i).join('.')} (null/undefined)`,
			);
		}
		if (current[part] === undefined || current[part] === null) {
			throw new NodeOperationError(node, `Path bulunamadı: ${parts.slice(0, i + 1).join('.')}`);
		}
		current = current[part];
	}

	if (!Array.isArray(current)) {
		throw new NodeOperationError(
			node,
			`Path "${pathStr}" bir array değil, mevcut tip: ${typeof current}`,
		);
	}

	// Array'in her item'ına field ekle
	for (let i = 0; i < current.length; i++) {
		if (current[i] && typeof current[i] === 'object' && !Array.isArray(current[i])) {
			current[i][fieldName] = fieldValue;
		}
	}
}

export class AddJsonData implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'U_Add JSON Data',
		name: 'addJsonData',
		icon: 'file:text.svg',
		group: ['transform'],
		version: 2,
		subtitle: '={{$parameter["operation"]}}',
		description: "JSON verisine field ekleme ve array item'larına field ekleme işlemleri",
		defaults: {
			name: 'Add JSON Data',
		},
		inputs: ['main'],
		outputs: ['main'],
		properties: [
			{
				displayName: 'Input JSON (Expression)',
				name: 'inputJson',
				type: 'string',
				default: '={{$json}}',
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				options: [
					{
						name: 'Add/Update Field',
						value: 'addField',
						description: "JSON path'e tek bir field ekle veya güncelle",
						action: 'Add or update a field',
					},
					{
						name: 'Add Field to Array Items',
						value: 'addFieldToArrayItems',
						description: "Bir array'in her item'ına tek bir field ekle",
						action: 'Add field to each array item',
					},
				],
				default: 'addField',
			},
			{
				displayName: 'JSON Path',
				name: 'jsonPath',
				type: 'string',
				default: '',
				placeholder: 'Body.QueryLimitResponse.QueryLimitResult.Value.LimitInformation',
				noDataExpression: true,
				description:
					'Değerin ekleneceği/güncelleneceği JSON path. Sadece JSON içi nokta ile ayrılmış path yazın, expression (={{...}}) YAZMAYIN. Örn: Body.QueryLimitResponse.QueryLimitResult.Value.LimitInformation',
				required: true,
			},
			{
				displayName: 'Field Name',
				name: 'singleFieldName',
				type: 'string',
				default: '',
				displayOptions: {
					show: {
						operation: ['addField'],
					},
				},
				description:
					'İsteğe bağlı. Sadece field adını yazmak isterseniz kullanın. Dolu ise JSON Path ile birleştirilir (örn: Path + . + Field Name).',
			},
			{
				displayName: 'Value Type',
				name: 'valueType',
				type: 'options',
				displayOptions: {
					show: {
						operation: ['addField'],
					},
				},
				options: [
					{
						name: 'Array',
						value: 'array',
					},
					{
						name: 'Boolean',
						value: 'boolean',
					},
					{
						name: 'Number',
						value: 'number',
					},
					{
						name: 'Object',
						value: 'object',
					},
					{
						name: 'String',
						value: 'string',
					},
				],
				default: 'string',
				description: 'Değerin tipi',
			},
			{
				displayName: 'Value',
				name: 'value',
				type: 'string',
				default: '',
				displayOptions: {
					show: {
						operation: ['addField'],
					},
				},
				description: 'Eklenecek/güncellenecek değer',
				required: true,
			},
			{
				displayName: 'Create Path if Not Exists',
				name: 'createPath',
				type: 'boolean',
				default: true,
				displayOptions: {
					show: {
						operation: ['addField'],
					},
				},
				description:
					'Whether to automatically create the path if it does not exist. If disabled, only assigns values to existing paths.',
			},
			{
				displayName: 'Field Name',
				name: 'fieldName',
				type: 'string',
				default: '',
				displayOptions: {
					show: {
						operation: ['addFieldToArrayItems'],
					},
				},
				description: "Array item'larına eklenecek field adı",
				required: true,
			},
			{
				displayName: 'Field Value Type',
				name: 'fieldValueType',
				type: 'options',
				displayOptions: {
					show: {
						operation: ['addFieldToArrayItems'],
					},
				},
				options: [
					{
						name: 'Array',
						value: 'array',
					},
					{
						name: 'Boolean',
						value: 'boolean',
					},
					{
						name: 'Number',
						value: 'number',
					},
					{
						name: 'Object',
						value: 'object',
					},
					{
						name: 'String',
						value: 'string',
					},
				],
				default: 'string',
				description: 'Field değerinin tipi',
			},
			{
				displayName: 'Field Value',
				name: 'fieldValue',
				type: 'string',
				default: '',
				displayOptions: {
					show: {
						operation: ['addFieldToArrayItems'],
					},
				},
				description: "Array item'larına eklenecek field değeri",
				required: true,
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnItems: INodeExecutionData[] = [];

		for (let i = 0; i < items.length; i++) {
			try {
				const inputJsonRaw = this.getNodeParameter('inputJson', i) as unknown;
				const operation = this.getNodeParameter('operation', i) as string;
				const jsonPathRaw = this.getNodeParameter('jsonPath', i) as unknown;

				// jsonPath'i string'e çevir
				let jsonPath: string;
				if (typeof jsonPathRaw === 'string') {
					jsonPath = jsonPathRaw.trim();
				} else if (jsonPathRaw !== null && jsonPathRaw !== undefined) {
					jsonPath = String(jsonPathRaw).trim();
				} else {
					jsonPath = '';
				}

				if (!jsonPath || jsonPath === '') {
					throw new NodeOperationError(this.getNode(), 'JSON Path boş olamaz');
				}

				// Input JSON'u parse et
				let inputJson: any;
				if (typeof inputJsonRaw === 'string') {
					const trimmed = inputJsonRaw.trim();
					if (trimmed === '') {
						throw new NodeOperationError(
							this.getNode(),
							'Input JSON parametresi boş. Lütfen bir expression girin (örn: {{$json}}).',
						);
					}
					// JSON string ise parse et
					if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
						try {
							inputJson = JSON.parse(trimmed);
						} catch (error) {
							// Parse edilemezse direkt değer olarak kullan
							inputJson = inputJsonRaw;
						}
					} else {
						inputJson = inputJsonRaw;
					}
				} else if (typeof inputJsonRaw === 'object' && inputJsonRaw !== null) {
					// Deep copy yap
					inputJson = JSON.parse(JSON.stringify(inputJsonRaw));
				} else {
					throw new NodeOperationError(
						this.getNode(),
						'Input JSON parametresi geçersiz. Object veya expression bekleniyor.',
					);
				}

				if (typeof inputJson !== 'object' || inputJson === null) {
					throw new NodeOperationError(this.getNode(), 'Input JSON bir object olmalıdır');
				}

				// Eğer input array ise, tüm item'ları işle ve tek bir array olarak döndür
				// Eğer input object ise, tek item olarak işlem yap
				const isInputArray = Array.isArray(inputJson);
				const itemsToProcess: any[] = isInputArray ? inputJson : [inputJson];
				const processedItems: any[] = [];

				for (let j = 0; j < itemsToProcess.length; j++) {
					const currentItem = itemsToProcess[j];

					// Her item için deep copy yap
					const processedItem = JSON.parse(JSON.stringify(currentItem));

					// Operation'a göre işlem yap
					if (operation === 'addField') {
						const valueType = this.getNodeParameter('valueType', i, 'string') as string;
						const valueRaw = this.getNodeParameter('value', i) as unknown;
						const createPath = this.getNodeParameter('createPath', i, true) as boolean;
						const singleFieldNameRaw = this.getNodeParameter('singleFieldName', i, '') as unknown;

						// Field name'i string'e çevir
						let singleFieldName = '';
						if (typeof singleFieldNameRaw === 'string') {
							singleFieldName = singleFieldNameRaw.trim();
						} else if (singleFieldNameRaw !== null && singleFieldNameRaw !== undefined) {
							singleFieldName = String(singleFieldNameRaw).trim();
						}

						// Eğer field name doluysa, path ile birleştir
						let targetPath = jsonPath;
						if (singleFieldName) {
							targetPath = `${jsonPath}.${singleFieldName}`;
						}

						// Value'yu type'a göre parse et
						const value = parseValueByType(valueRaw, valueType, this.getNode());

						setValueByPath(processedItem, targetPath, value, createPath, this.getNode());
					} else if (operation === 'addFieldToArrayItems') {
						const fieldNameRaw = this.getNodeParameter('fieldName', i) as unknown;
						const fieldValueType = this.getNodeParameter('fieldValueType', i, 'string') as string;
						const fieldValueRaw = this.getNodeParameter('fieldValue', i) as unknown;

						// Field name'i string'e çevir
						let fieldName: string;
						if (typeof fieldNameRaw === 'string') {
							fieldName = fieldNameRaw.trim();
						} else if (fieldNameRaw !== null && fieldNameRaw !== undefined) {
							fieldName = String(fieldNameRaw).trim();
						} else {
							fieldName = '';
						}

						if (!fieldName || fieldName === '') {
							throw new NodeOperationError(this.getNode(), 'Field Name boş olamaz');
						}

						// Field value'yu type'a göre parse et
						const fieldValue = parseValueByType(fieldValueRaw, fieldValueType, this.getNode());

						addFieldToArrayItems(processedItem, jsonPath, fieldName, fieldValue, this.getNode());
					}

					processedItems.push(processedItem);
				}

				// Input array ise, tek bir array output olarak döndür
				// Input object ise, tek item olarak döndür
				if (isInputArray) {
					returnItems.push({
						json: processedItems as any,
						pairedItem: { item: i },
					});
				} else {
					returnItems.push({
						json: processedItems[0],
						pairedItem: { item: i },
					});
				}
			} catch (error) {
				if (this.continueOnFail()) {
					returnItems.push({
						json: {
							...items[i].json,
							error: error instanceof Error ? error.message : String(error),
						},
						pairedItem: { item: i },
					});
					continue;
				}
				throw error;
			}
		}

		return [returnItems];
	}
}
