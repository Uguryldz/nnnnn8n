import type {
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	INode,
	IDataObject,
} from 'n8n-workflow';
import { NodeOperationError, ApplicationError } from 'n8n-workflow';
import { parseString } from 'xml2js';

const parseStringAsync = (xml: string, options?: any): Promise<any> => {
	return new Promise((resolve, reject) => {
		parseString(xml, options, (err, result) => {
			if (err) {
				reject(err);
			} else {
				resolve(result);
			}
		});
	});
};

interface FieldSchema {
	FieldName: string;
	length: string;
	StartIndex: string;
	Description?: string;
	InputType?: string;
	OutputType?: string;
	Trim?: string;
}

interface FileSchema {
	FileSchema: {
		Header?: {
			Field: FieldSchema | FieldSchema[];
		};
		Line?: {
			Field: FieldSchema | FieldSchema[];
		};
		Footer?: {
			Field: FieldSchema | FieldSchema[];
		};
	};
}

interface ParsedField {
	name: string;
	value: string;
	description?: string;
}

interface ParsedSchemas {
	header: FieldSchema[];
	line: FieldSchema[];
	footer: FieldSchema[];
}

const parseSchema = async (schemaXml: string): Promise<ParsedSchemas> => {
	try {
		const result = await parseStringAsync(schemaXml, {
			explicitArray: false,
			mergeAttrs: true,
		});

		const fileSchema = result as FileSchema;
		const fileSchemaData = fileSchema.FileSchema;

		const parseFields = (fields: FieldSchema | FieldSchema[] | undefined): FieldSchema[] => {
			if (!fields) {
				return [];
			}
			const fieldArray = Array.isArray(fields) ? fields : [fields];
			return fieldArray.map((field) => ({
				FieldName: field.FieldName || '',
				length: field.length || '0',
				StartIndex: field.StartIndex || '0',
				Description: field.Description,
				InputType: field.InputType,
				OutputType: field.OutputType,
				Trim: field.Trim,
			}));
		};

		return {
			header: parseFields(fileSchemaData?.Header?.Field),
			line: parseFields(fileSchemaData?.Line?.Field),
			footer: parseFields(fileSchemaData?.Footer?.Field),
		};
	} catch (error) {
		throw new ApplicationError(
			`Şema parse edilemedi: ${error instanceof Error ? error.message : 'Bilinmeyen hata'}`,
		);
	}
};

const trimLeadingZerosAndSpaces = (str: string): string => {
	return str.replace(/^[0\s]+/, '');
};

const parseLine = (line: string, fields: FieldSchema[]): ParsedField[] => {
	const parsedFields: ParsedField[] = [];

	for (const field of fields) {
		// StartIndex 1-based: StartIndex="1" ise 2. karakterden başlar (substring(1))
		const startIndexRaw = parseInt(field.StartIndex, 10);
		const length = parseInt(field.length, 10) || 0;

		// length=0 ve StartIndex=0 ise boş string döndür
		if (length === 0 && (isNaN(startIndexRaw) || startIndexRaw === 0)) {
			parsedFields.push({
				name: field.FieldName,
				value: '',
				description: field.Description,
			});
			continue;
		}

		// StartIndex direkt kullanılır: StartIndex="1" → substring(1), StartIndex="2" → substring(2)
		const startIndex = isNaN(startIndexRaw) ? 0 : startIndexRaw;
		let value = '';

		if (length > 0 && startIndex >= 0 && startIndex < line.length) {
			const endIndex = startIndex + length;
			value = line.substring(startIndex, Math.min(endIndex, line.length));
		} else if (length === 0 && startIndex > 0 && startIndex < line.length) {
			value = line.substring(startIndex);
		}

		// Trim=True ise başındaki 0 ve boşlukları temizle
		if (field.Trim === 'True' || field.Trim === 'true') {
			value = trimLeadingZerosAndSpaces(value);
		} else {
			// Trim yoksa sadece normal trim yap
			value = value.trim();
		}

		// Tarih formatı dönüşümü - InputType ve OutputType tanımlı ise
		if (field.InputType && field.OutputType && value) {
			value = convertDateFormat(value, field.InputType, field.OutputType);
		}

		parsedFields.push({
			name: field.FieldName,
			value,
			description: field.Description,
		});
	}

	return parsedFields;
};

const convertDateFormat = (dateStr: string, inputType: string, outputType: string): string => {
	if (!dateStr || !inputType || !outputType) {
		return dateStr;
	}

	try {
		// yyyyMMdd -> yyyy-MM-dd
		if (inputType === 'yyyyMMdd' && outputType === 'yyyy-MM-dd') {
			if (dateStr.length === 8) {
				return `${dateStr.substring(0, 4)}-${dateStr.substring(4, 6)}-${dateStr.substring(6, 8)}`;
			}
		}

		// ddMMyyyy -> yyyy-MM-dd
		if (inputType === 'ddMMyyyy' && outputType === 'yyyy-MM-dd') {
			if (dateStr.length === 8) {
				return `${dateStr.substring(4, 8)}-${dateStr.substring(2, 4)}-${dateStr.substring(0, 2)}`;
			}
		}

		// MMddyyyy -> yyyy-MM-dd
		if (inputType === 'MMddyyyy' && outputType === 'yyyy-MM-dd') {
			if (dateStr.length === 8) {
				return `${dateStr.substring(4, 8)}-${dateStr.substring(0, 2)}-${dateStr.substring(2, 4)}`;
			}
		}

		// Diğer formatlar için genel bir yaklaşım
		// Burada daha fazla format eklenebilir

		return dateStr;
	} catch (error) {
		return dateStr;
	}
};

const parseContent = (
	headerContent: string | undefined,
	lineContent: string,
	footerContent: string,
	headerSchema: FieldSchema[],
	lineSchema: FieldSchema[],
	footerSchema: FieldSchema[],
	node: INode,
): IDataObject => {
	const result: IDataObject = {};

	// Header parse - şema yoksa boş string
	if (headerSchema.length === 0) {
		result.header = '';
	} else {
		if (!headerContent || !headerContent.trim()) {
			throw new NodeOperationError(node, 'Header Input boş olamaz.');
		}
		const headerLines = headerContent.split('\n').filter((line) => line.trim().length > 0);
		if (headerLines.length > 0) {
			const parsedHeader = parseLine(headerLines[0], headerSchema);
			result.header = parsedHeader.reduce((acc, field) => {
				acc[field.name] = field.value;
				return acc;
			}, {} as IDataObject);
		} else {
			result.header = '';
		}
	}

	// Line parse
	if (!lineContent || !lineContent.trim()) {
		throw new NodeOperationError(node, 'Line Input boş olamaz.');
	}
	const lineLines = lineContent.split('\n').filter((line) => line.trim().length > 0);
	result.lines = lineLines.map((line) => {
		const parsedLine = parseLine(line, lineSchema);
		return parsedLine.reduce((acc, field) => {
			acc[field.name] = field.value;
			return acc;
		}, {} as IDataObject);
	});

	// Footer parse - şema yoksa boş string
	if (footerSchema.length === 0) {
		result.footer = '';
	} else {
		if (!footerContent || !footerContent.trim()) {
			throw new NodeOperationError(node, 'Footer Input boş olamaz.');
		}
		const footerLines = footerContent.split('\n').filter((line) => line.trim().length > 0);
		if (footerLines.length > 0) {
			const parsedFooter = parseLine(footerLines[0], footerSchema);
			result.footer = parsedFooter.reduce((acc, field) => {
				acc[field.name] = field.value;
				return acc;
			}, {} as IDataObject);
		} else {
			result.footer = '';
		}
	}

	return result;
};

export class USchemaContentMapper implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'U_Schema_ContentMapper',
		name: 'uSchemaContentMapper',
		icon: 'fa:file-alt',
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["operation"]}}',
		description: 'XML şema kullanarak content mapping yapar',
		defaults: {
			name: 'U_Schema_ContentMapper',
		},
		inputs: ['main'],
		outputs: ['main'],
		properties: [
			{
				displayName: 'Schema XML',
				name: 'schemaXml',
				type: 'string',
				typeOptions: {
					rows: 10,
				},
				default: '',
				description: 'FileSchema XML içeriği',
				required: true,
			},
			{
				displayName: 'Header Input',
				name: 'headerInput',
				type: 'string',
				typeOptions: {
					rows: 4,
				},
				default: '',
				description: 'Header içeriği',
			},
			{
				displayName: 'Line Input',
				name: 'lineInput',
				type: 'string',
				typeOptions: {
					rows: 10,
				},
				default: '',
				description: 'Line içeriği (her satır bir kayıt)',
				required: true,
			},
			{
				displayName: 'Footer Input',
				name: 'footerInput',
				type: 'string',
				typeOptions: {
					rows: 4,
				},
				default: '',
				description: 'Footer içeriği',
				required: true,
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const node = this.getNode();
		const returnData: INodeExecutionData[] = [];

		for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
			try {
				const schemaXml = this.getNodeParameter('schemaXml', itemIndex) as string;
				const headerInput = this.getNodeParameter('headerInput', itemIndex) as string;
				const lineInput = this.getNodeParameter('lineInput', itemIndex) as string;
				const footerInput = this.getNodeParameter('footerInput', itemIndex) as string;

				if (!schemaXml || !schemaXml.trim()) {
					throw new NodeOperationError(node, 'Schema XML boş olamaz.');
				}

				const schemas = await parseSchema(schemaXml);

				const parsedContent = parseContent(
					headerInput,
					lineInput,
					footerInput,
					schemas.header,
					schemas.line,
					schemas.footer,
					node,
				);

				returnData.push({
					json: parsedContent,
					pairedItem: { item: itemIndex },
				});
			} catch (error) {
				if (this.continueOnFail()) {
					returnData.push({
						json: {
							error: error instanceof Error ? error.message : 'Bilinmeyen hata',
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

		return [returnData];
	}
}
