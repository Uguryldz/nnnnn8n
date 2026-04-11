import type {
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';
import Handlebars from 'handlebars';

// Handlebars GET Helper
// Array + nested object path destekler (test.js formatında)
Handlebars.registerHelper('get', function (obj: any, path: string) {
	try {
		return path.split('.').reduce((acc: any, key: string) => {
			// array index varsa → örn: LimitInformation[0] (regex ile)
			const match = key.match(/(.+)\[(\d+)\]/);
			if (match) {
				return acc[match[1]][parseInt(match[2])];
			}
			return acc[key];
		}, obj);
	} catch (e) {
		return '';
	}
});

// Handlebars Array Check Helper - Array var mı ve dolu mu kontrol eder
Handlebars.registerHelper('hasArray', function (obj: any, path: string) {
	try {
		const result = path.split('.').reduce((acc: any, key: string) => {
			const match = key.match(/(.+)\[(\d+)\]/);
			if (match) {
				return acc[match[1]][parseInt(match[2])];
			}
			return acc[key];
		}, obj);
		return Array.isArray(result) && result.length > 0;
	} catch (e) {
		return false;
	}
});

export class U_CDataJsonArrayXml implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'U_CData_JsonArray_Xml',
		name: 'uCDataJsonArrayXml',
		icon: 'fa:code',
		group: ['transform'],
		version: 1,
		subtitle: 'JSON to XML with Template',
		description: "JSON verisini Handlebars template ile XML'e dönüştürür",
		defaults: {
			name: 'U_CData_JsonArray_Xml',
		},
		inputs: ['main'],
		outputs: ['main'],
		properties: [
			{
				displayName: 'JSON Data',
				name: 'jsonData',
				type: 'json',
				default: '{}',
				description: 'JSON verisi (input.JSON formatında)',
				required: true,
			},
			{
				displayName: 'XML Template',
				name: 'xmlTemplate',
				type: 'string',
				typeOptions: {
					rows: 10,
				},
				default: `<?xml version="1.0" encoding="UTF-8"?>   
<string xmlns="http://tempuri.org/">   
<Output>   
<Data>  

<ParentKodu>OK</ParentKodu>  

<SonucMesaj>
[[get parsedData "Body.QueryLimitResponse.QueryLimitResult.ResponseMessage"]]
</SonucMesaj>

[[#if (hasArray parsedData "Body.QueryLimitResponse.QueryLimitResult.Value.LimitInformation")]]
[[#each (get parsedData "Body.QueryLimitResponse.QueryLimitResult.Value.LimitInformation")]]
<LimitSonuc> 
    <SonucIslemKodu>OK</SonucIslemKodu>  
    <SonucIslemMesaj>[[this.LimitExpiryDate]]</SonucIslemMesaj>
    <AboneNo>[[this.PurchaserCode]]</AboneNo>
    <ToplamLimit>[[this.GuarantedInvoiceAmount]]</ToplamLimit>
    <KalanGarantiliLimit>[[this.AvailableLimit]]</KalanGarantiliLimit>
    <DovizCinsi>TL</DovizCinsi>
    <BankaTransactionId>21654651</BankaTransactionId> 
    <HataKodu>UNI001</HataKodu> 
    <HataAciklama>[[this.LimitExpiryDate]]</HataAciklama>
</LimitSonuc>
[[/each]]
[[/if]]

</Data>   
</Output>   
</string>`,
				description: 'Handlebars XML template (temp.xml formatında)',
				required: true,
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];
		const node = this.getNode();

		for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
			try {
				// JSON Data al
				const jsonDataInput = this.getNodeParameter('jsonData', itemIndex) as unknown;
				let parsedJson: any;

				// JSON data'yı parse et
				if (typeof jsonDataInput === 'string') {
					try {
						parsedJson = JSON.parse(jsonDataInput);
					} catch (error) {
						throw new NodeOperationError(
							node,
							`Item ${itemIndex + 1}: Geçersiz JSON formatı: ${error}`,
						);
					}
				} else if (typeof jsonDataInput === 'object' && jsonDataInput !== null) {
					parsedJson = jsonDataInput;
				} else {
					throw new NodeOperationError(node, `Item ${itemIndex + 1}: JSON data geçersiz formatta.`);
				}

				// XML Template al
				const xmlTemplate = this.getNodeParameter('xmlTemplate', itemIndex) as string;

				if (!xmlTemplate || !xmlTemplate.trim()) {
					throw new NodeOperationError(node, `Item ${itemIndex + 1}: XML template boş olamaz.`);
				}

				// Köşeli parantezli Handlebars → normal Handlebars dönüşümü
				// [[ ]] → {{ }}
				const compiledTemplate = xmlTemplate.replace(/\[\[/g, '{{').replace(/]]/g, '}}');

				// Handlebars compile (noEscape: true ile)
				const compiled = Handlebars.compile(compiledTemplate, { noEscape: true });

				// JSON içine gerekli üst key'i ekliyoruz (test.js formatında)
				// parsedData doğrudan kullanılıyor
				const fullData = parsedJson.Body?.QueryLimitResponse ? parsedJson : parsedJson;

				// Array'i bul (LimitInformation path'ini template'den çıkar veya sabit path kullan)
				// Template'de kullanılan path: Body.QueryLimitResponse.QueryLimitResult.Value.LimitInformation
				const arrayPath = 'Body.QueryLimitResponse.QueryLimitResult.Value.LimitInformation';
				const arrayPathParts = arrayPath.split('.');
				let arrayData: any[] = [];

				try {
					let current: any = fullData;
					for (const part of arrayPathParts) {
						if (current && typeof current === 'object') {
							current = current[part];
						} else {
							current = null;
							break;
						}
					}
					if (Array.isArray(current) && current.length > 0) {
						arrayData = current;
					}
				} catch (e) {
					// Array bulunamadı, devam et
				}

				// Eğer array varsa ve doluysa, her eleman için ayrı output üret
				if (arrayData.length > 0) {
					for (let arrayIndex = 0; arrayIndex < arrayData.length; arrayIndex++) {
						// Her array elemanı için ayrı data context oluştur
						const data = {
							parsedData: fullData,
							currentItem: arrayData[arrayIndex],
							currentIndex: arrayIndex,
						};

						// XML üret
						const outputXml = compiled(data);

						// Sonucu döndür
						const baseJson = items[itemIndex]?.json ?? {};
						returnData.push({
							json: {
								...baseJson,
								xml: outputXml,
							},
							pairedItem: { item: itemIndex },
						});
					}
				}
				// Array yoksa veya boşsa, output üretme (boş sonuç döndürme)
			} catch (error) {
				if (this.continueOnFail()) {
					returnData.push({
						json: {
							error: error instanceof Error ? error.message : 'Bilinmeyen hata',
						},
						pairedItem: { item: itemIndex },
					});
					continue;
				}
				throw error;
			}
		}

		return [returnData];
	}
}
