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

// Helper fonksiyonlar
function removeNamespacePrefix(key: string): string {
	// "sch:request" -> "request", "soapenv:body" -> "body"
	const colonIndex = key.indexOf(':');
	return colonIndex > -1 ? key.substring(colonIndex + 1) : key;
}

function toCamelCase(str: string): string {
	const withoutPrefix = removeNamespacePrefix(str);
	// "suppliercode" -> "supplierCode", "purchasercode" -> "purchaserCode"
	// Önce tüm harfleri küçük yap, sonra kelime sınırlarını bul ve camelCase'e çevir
	return withoutPrefix
		.toLowerCase()
		.replace(/([a-z])([A-Z])/g, '$1_$2') // Mevcut camelCase'i underscore'a çevir
		.split(/[_\s-]+/) // Underscore, boşluk veya tire ile ayır
		.map((word, index) => {
			if (index === 0) {
				return word; // İlk kelime küçük harfle başlar
			}
			return word.charAt(0).toUpperCase() + word.slice(1);
		})
		.join('');
}

function flattenObject(obj: any, prefix = '', result: IDataObject = {}): IDataObject {
	if (obj === null || obj === undefined) {
		return result;
	}

	if (typeof obj !== 'object') {
		if (prefix) {
			result[prefix] = obj;
		}
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
		if (key === '$') continue; // $ attribute'larını zaten işledik

		const cleanKey = removeNamespacePrefix(key);
		const normalizedKey = toCamelCase(cleanKey);
		const newPrefix = prefix ? `${prefix}_${normalizedKey}` : normalizedKey;

		if (Array.isArray(value)) {
			value.forEach((item, index) => {
				flattenObject(item, `${newPrefix}_${index}`, result);
			});
		} else if (typeof value === 'object' && value !== null) {
			flattenObject(value, newPrefix, result);
		} else {
			result[newPrefix] = value as GenericValue;
		}
	}

	return result;
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

function extractBodyData(body: any): IDataObject {
	const result: IDataObject = {};

	if (!body || typeof body !== 'object') {
		return result;
	}

	// Body içindeki tüm namespace'li key'leri işle
	for (const [key, value] of Object.entries(body)) {
		if (key === '$') continue; // Attribute'ları atla

		const cleanKey = removeNamespacePrefix(key);
		const camelKey = toCamelCase(cleanKey);

		if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
			// Nested object ise, içeriğini recursive olarak işle
			if (Object.keys(value).length === 0) {
				result[camelKey] = value;
			} else {
				// İçerideki tüm alanları çıkar
				for (const [innerKey, innerValue] of Object.entries(value)) {
					if (innerKey === '$') continue;
					const innerCleanKey = removeNamespacePrefix(innerKey);
					const innerCamelKey = toCamelCase(innerCleanKey);

					if (typeof innerValue === 'object' && innerValue !== null && !Array.isArray(innerValue)) {
						// Daha derin nested yapı varsa, düzleştir
						const flattened = flattenObject(innerValue, `${camelKey}_${innerCamelKey}`);
						Object.assign(result, flattened);
					} else {
						result[`${camelKey}_${innerCamelKey}`] = innerValue;
					}
				}
			}
		} else if (Array.isArray(value)) {
			result[camelKey] = value as GenericValue;
		} else {
			result[camelKey] = value as GenericValue;
		}
	}

	return result;
}

export class SoapWebhookParser implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'SOAP Webhook Parser',
		name: 'soapWebhookParser',
		icon: 'file:soapRequest.svg',
		group: ['transform'],
		version: 1,
		description: "SOAP webhook body'sini parse eder ve kullanılabilir formata dönüştürür",
		defaults: {
			name: 'SOAP Webhook Parser',
		},
		inputs: ['main'],
		outputs: ['main'],
		properties: [
			{
				displayName: 'Input Property Name',
				name: 'inputPropertyName',
				type: 'string',
				default: 'body',
				description: "SOAP webhook body'sinin bulunduğu property adı (örn: body)",
				required: true,
			},
			{
				displayName: 'Output Format',
				name: 'outputFormat',
				type: 'options',
				options: [
					{
						name: 'Flattened (Düzleştirilmiş)',
						value: 'flattened',
						description: 'Tüm alanları düzleştirilmiş formatta çıkar',
					},
					{
						name: 'Structured (Yapılandırılmış)',
						value: 'structured',
						description: 'Request ve diğer alanları yapılandırılmış formatta çıkar',
					},
				],
				default: 'structured',
				description: 'Çıktı formatı',
			},
			{
				displayName: 'Extract Operation Name',
				name: 'extractOperationName',
				type: 'boolean',
				default: true,
				description: 'SOAP operation adını çıkar (örn: qinv)',
			},
			{
				displayName: 'Extract Namespaces',
				name: 'extractNamespaces',
				type: 'boolean',
				default: true,
				description: 'Namespace bilgilerini çıkar',
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
				const extractOperationName = this.getNodeParameter(
					'extractOperationName',
					itemIndex,
					true,
				) as boolean;
				const extractNamespaces = this.getNodeParameter(
					'extractNamespaces',
					itemIndex,
					true,
				) as boolean;
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

				// SOAP data'yı al
				// inputPropertyName expression olabilir (örn: {{ $json.body }})
				// n8n expression'ları otomatik evaluate eder
				let soapData: any = null;

				// Eğer inputPropertyName bir object ise, zaten evaluate edilmiş değerdir
				if (inputPropertyName && typeof inputPropertyName === 'object') {
					soapData = inputPropertyName;
				} else if (inputPropertyName && typeof inputPropertyName === 'string') {
					// String ise, property adı olarak kullan
					if (inputPropertyName in itemData) {
						soapData = itemData[inputPropertyName];
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
					// inputPropertyName belirtilmemişse, tüm item'ı kullan
					soapData = itemData;
				}

				// Eğer soapData hala null veya undefined ise
				if (soapData === null || soapData === undefined) {
					throw new NodeOperationError(
						this.getNode(),
						`'${inputPropertyName}' property'si null veya undefined`,
						{
							itemIndex,
						},
					);
				}

				// Envelope'u bul
				let envelope: any = null;
				for (const [key, value] of Object.entries(soapData)) {
					if (key.toLowerCase().includes('envelope') || key.toLowerCase().includes('soap')) {
						envelope = value;
						break;
					}
				}

				if (!envelope || typeof envelope !== 'object') {
					// Envelope bulunamazsa, direkt soapData'yı kullan
					envelope = soapData;
				}

				// Tüm namespace'leri temizle ve yapıyı koru
				const cleanedEnvelope = cleanNamespaces(envelope);

				// Çıktı formatına göre işle
				let parsed: IDataObject = {};

				if (outputFormat === 'flattened') {
					// Düzleştirilmiş format
					const body = cleanedEnvelope.body || cleanedEnvelope;
					const flattened = extractBodyData(body);
					parsed = flattened;
				} else {
					// Yapılandırılmış format - envelope yapısını koru
					parsed = cleanedEnvelope as IDataObject;
				}

				// Namespace'leri ekle (eğer isteniyorsa)
				if (extractNamespaces && envelope.$) {
					parsed.namespaces = {} as IDataObject;
					for (const [key, value] of Object.entries(envelope.$)) {
						const cleanKey = removeNamespacePrefix(key);
						(parsed.namespaces as IDataObject)[cleanKey] = value as GenericValue;
					}
				}

				// Operation adını ekle (eğer isteniyorsa)
				if (extractOperationName && cleanedEnvelope.body) {
					const bodyKeys = Object.keys(cleanedEnvelope.body).filter((k) => k !== '$');
					if (bodyKeys.length > 0) {
						parsed.operation = bodyKeys[0];
					}
				}

				// Output oluştur - sadece parse edilmiş veriyi döndür
				const newItem: IDataObject = {
					[outputPropertyName]: parsed,
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
