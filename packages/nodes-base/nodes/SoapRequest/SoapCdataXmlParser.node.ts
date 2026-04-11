import type {
	IExecuteFunctions,
	IDataObject,
	INodeExecutionData,
	INodeProperties,
	INodeType,
	INodeTypeDescription,
	GenericValue,
} from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';
import { XMLParser } from 'fast-xml-parser';

// Helper fonksiyonlar
function removeNamespacePrefix(key: string): string {
	const colonIndex = key.indexOf(':');
	return colonIndex > -1 ? key.substring(colonIndex + 1) : key;
}

function cleanNamespaces(obj: any): any {
	if (obj === null || obj === undefined) {
		return obj;
	}

	if (Array.isArray(obj)) {
		return obj.map((item) => cleanNamespaces(item));
	}

	if (typeof obj !== 'object') {
		return obj;
	}

	const cleaned: IDataObject = {};

	for (const [key, value] of Object.entries(obj)) {
		if (key === '$') continue; // Attribute'ları atla

		const cleanKey = removeNamespacePrefix(key);
		const cleanedValue = cleanNamespaces(value);
		cleaned[cleanKey] = cleanedValue as GenericValue;
	}

	return cleaned;
}

function extractCdataContent(xmlString: string): string | null {
	// CDATA pattern'ini bul
	const cdataPattern = /<!\[CDATA\[(.*?)\]\]>/gs;
	const matches = [...xmlString.matchAll(cdataPattern)];

	if (matches.length > 0) {
		// İlk CDATA'yı döndür
		return matches[0][1];
	}

	// CDATA yoksa, direkt XML string'i döndür
	return xmlString;
}

function flattenObject(obj: any, prefix = '', result: IDataObject = {}): IDataObject {
	if (obj === null || obj === undefined) {
		return result;
	}

	if (typeof obj !== 'object') {
		if (prefix) {
			result[prefix] = obj as GenericValue;
		}
		return result;
	}

	if (Array.isArray(obj)) {
		obj.forEach((item, index) => {
			flattenObject(item, `${prefix}_${index}`, result);
		});
		return result;
	}

	// Eğer $ attribute'ları varsa, onları da ekle
	if (obj.$) {
		for (const [key, value] of Object.entries(obj.$)) {
			const cleanKey = removeNamespacePrefix(key);
			result[`${prefix ? prefix + '_' : ''}${cleanKey}`] = value as GenericValue;
		}
	}

	// Diğer property'leri işle
	for (const [key, value] of Object.entries(obj)) {
		if (key === '$') continue;

		const cleanKey = removeNamespacePrefix(key);
		const newPrefix = prefix ? `${prefix}_${cleanKey}` : cleanKey;

		if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
			flattenObject(value, newPrefix, result);
		} else {
			result[newPrefix] = value as GenericValue;
		}
	}

	return result;
}

export class SoapCdataXmlParser implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'SOAP CDATA XML Parser',
		name: 'soapCdataXmlParser',
		icon: 'file:soapRequest.svg',
		group: ['transform'],
		version: 1,
		description: "SOAP CDATA içindeki XML'i parse eder ve kullanılabilir formata dönüştürür",
		defaults: {
			name: 'SOAP CDATA XML Parser',
		},
		inputs: ['main'],
		outputs: ['main'],
		properties: [
			{
				displayName: 'Input Property Name',
				name: 'inputPropertyName',
				type: 'string',
				default: 'body',
				description: 'CDATA XML içeriğinin bulunduğu property adı',
				required: true,
			},
			{
				displayName: 'Output Format',
				name: 'outputFormat',
				type: 'options',
				options: [
					{
						name: 'Structured (Yapılandırılmış)',
						value: 'structured',
						description: 'XML yapısını koruyarak parse et',
					},
					{
						name: 'Flattened (Düzleştirilmiş)',
						value: 'flattened',
						description: 'Tüm alanları düzleştirilmiş formatta çıkar',
					},
				],
				default: 'structured',
				description: 'Çıktı formatı',
			},
			{
				displayName: 'Output Property Name',
				name: 'outputPropertyName',
				type: 'string',
				default: 'parsed',
				description: 'Parse edilmiş verinin saklanacağı property adı',
			},
		] as INodeProperties[],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];
		const xmlParser = new XMLParser({
			ignoreAttributes: false,
			attributeNamePrefix: '@_',
			ignoreDeclaration: true,
			parseTagValue: true,
			trimValues: true,
		});

		for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
			try {
				const inputPropertyName = this.getNodeParameter(
					'inputPropertyName',
					itemIndex,
					'body',
				) as string;
				const outputFormat = this.getNodeParameter(
					'outputFormat',
					itemIndex,
					'structured',
				) as string;
				const outputPropertyName = this.getNodeParameter(
					'outputPropertyName',
					itemIndex,
					'parsed',
				) as string;

				const itemData = items[itemIndex]?.json;
				if (!itemData) {
					throw new NodeOperationError(this.getNode(), 'Input verisi bulunamadı', {
						itemIndex,
					});
				}

				// XML data'yı al
				let xmlData: any = null;

				// Eğer inputPropertyName bir object ise, zaten evaluate edilmiş değerdir
				if (inputPropertyName && typeof inputPropertyName === 'object') {
					xmlData = inputPropertyName;
				} else if (inputPropertyName && typeof inputPropertyName === 'string') {
					// String ise, önce XML string olup olmadığını kontrol et
					if (
						inputPropertyName.trim().startsWith('<?xml') ||
						inputPropertyName.trim().startsWith('<')
					) {
						// XML string ise direkt kullan
						xmlData = inputPropertyName;
					} else if (inputPropertyName in itemData) {
						// Property adı ise, property'den al
						xmlData = itemData[inputPropertyName];
					} else {
						throw new NodeOperationError(
							this.getNode(),
							`'${inputPropertyName}' property'si bulunamadı. Mevcut property'ler: ${Object.keys(itemData).join(', ')}`,
							{
								itemIndex,
							},
						);
					}
				} else {
					xmlData = itemData;
				}

				// XML string'e çevir - sadece string olarak gelen veriyi kullan
				let xmlString = '';
				if (typeof xmlData === 'string') {
					xmlString = xmlData;
				} else {
					throw new NodeOperationError(this.getNode(), 'XML içeriği string formatında olmalıdır', {
						itemIndex,
						description: `Gelen veri tipi: ${typeof xmlData}`,
					});
				}

				if (!xmlString || xmlString.trim() === '') {
					throw new NodeOperationError(this.getNode(), 'XML içeriği bulunamadı veya boş', {
						itemIndex,
					});
				}

				// CDATA'yı çıkar
				const cdataContent = extractCdataContent(xmlString);
				if (cdataContent) {
					xmlString = cdataContent;
				}

				// XML'i parse et
				let parsed: any;
				try {
					parsed = xmlParser.parse(xmlString);
				} catch (error) {
					throw new NodeOperationError(
						this.getNode(),
						`XML parse hatası: ${(error as Error).message}`,
						{
							itemIndex,
							description: `XML içeriği: ${xmlString.substring(0, 200)}...`,
						},
					);
				}

				// Namespace'leri temizle
				parsed = cleanNamespaces(parsed);

				// Output formatına göre işle
				let result: IDataObject = {};
				if (outputFormat === 'flattened') {
					// Düzleştirilmiş format için recursive flatten
					result = flattenObject(parsed);
				} else {
					// Yapılandırılmış format - direkt kullan
					result = parsed as IDataObject;
				}

				// Output oluştur - sadece parse edilmiş veriyi döndür
				const newItem: IDataObject = {
					[outputPropertyName]: result,
				};

				returnData.push({
					json: newItem,
					pairedItem: {
						item: itemIndex,
					},
				});
			} catch (error) {
				if (this.continueOnFail()) {
					returnData.push({
						json: {
							error: (error as Error).message,
						},
						pairedItem: {
							item: itemIndex,
						},
					});
					continue;
				}

				if (error instanceof NodeOperationError) {
					throw error;
				}

				throw new NodeOperationError(this.getNode(), error as Error, {
					itemIndex,
				});
			}
		}

		return [returnData];
	}
}
