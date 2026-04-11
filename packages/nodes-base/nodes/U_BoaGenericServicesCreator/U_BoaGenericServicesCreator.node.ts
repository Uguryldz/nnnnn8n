import type {
	IExecuteFunctions,
	INode,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

interface FieldRule {
	operation: string;
	field: string;
}

const normalizeCsv = (value: string | undefined): string[] => {
	if (!value) return [];
	return value
		.split(',')
		.map((v) => v.trim())
		.filter((v) => v.length > 0);
};

const normalizeFieldRules = (input: unknown, node: INode): FieldRule[] => {
	if (Array.isArray(input)) {
		return (input as unknown[]).flatMap((entry) => {
			if (typeof entry !== 'object' || entry === null) return [];
			const obj = entry as { operation?: string; field?: string };
			if (!obj.operation || !obj.field) return [];
			return [
				{
					operation: String(obj.operation).trim(),
					field: String(obj.field).trim(),
				},
			];
		});
	}

	if (typeof input === 'string') {
		const trimmed = input.trim();
		if (!trimmed) return [];
		try {
			const parsed = JSON.parse(trimmed);
			return normalizeFieldRules(parsed, node);
		} catch (error) {
			throw new NodeOperationError(
				node,
				`fieldRules JSON formatı geçersiz: ${(error as Error).message}`,
			);
		}
	}

	return [];
};

export class U_BoaGenericServicesCreator implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'U_BOA Generic Services Creator',
		name: 'uBoaGenericServicesCreator',
		icon: 'fa:file-code',
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["operation"]}}',
		description:
			'Verilen WSDL içinden seçili methodları ve alanları kaldırarak filtrelenmiş yeni bir WSDL üretir',
		defaults: {
			name: 'U_BOA_Generic_ServicesCreator',
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
						name: 'Filter WSDL',
						value: 'filterWsdl',
					},
				],
				default: 'filterWsdl',
			},
			{
				displayName: 'WSDL Content',
				name: 'wsdlContent',
				type: 'string',
				typeOptions: {
					rows: 10,
				},
				default: '',
				required: true,
				description:
					'Filtrelenecek WSDL metni. Örn: IntegrationHubDbsService (4).wsdl dosya içeriği.',
			},
			{
				displayName: 'Kaldırılacak Methodlar',
				name: 'operationsToRemove',
				type: 'string',
				default: 'QueryInvoice,QueryProvisionWithInvoice',
				description:
					'Virgülle ayırarak method isimleri. Örn: QueryInvoice,CreateInvoice (tam method adı).',
			},
			{
				displayName: 'Alan Kuralları (JSON)',
				name: 'fieldRules',
				type: 'json',
				default:
					'[{"operation":"QueryInvoice","field":"SupplierCode"},{"operation":"QueryInvoice","field":"PurchaserCode"},{"operation":"QueryProvisionWithInvoice","field":"LimitAmount"}]',
				description:
					'Belirli method içinden alan kaldırmak için. Örn: [{"operation":"QueryInvoice","field":"SupplierCode"}].',
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const operation = this.getNodeParameter('operation', 0) as string;
		const node = this.getNode();

		if (operation !== 'filterWsdl') {
			return [items];
		}

		const returnData: INodeExecutionData[] = [];

		for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
			try {
				const wsdlContent = this.getNodeParameter('wsdlContent', itemIndex) as string;
				if (!wsdlContent || !wsdlContent.trim()) {
					throw new NodeOperationError(node, 'WSDL içeriği boş olamaz.');
				}

				const operationsCsv = this.getNodeParameter('operationsToRemove', itemIndex, '') as string;
				const operationsToRemove = normalizeCsv(operationsCsv);

				const fieldRulesInput = this.getNodeParameter('fieldRules', itemIndex) as unknown;
				const fieldRules = normalizeFieldRules(fieldRulesInput, node);

				if (operationsToRemove.length === 0 && fieldRules.length === 0) {
					// Hiç kural yoksa WSDL'i aynen geri ver
					returnData.push({
						json: {
							...(items[itemIndex].json ?? {}),
							wsdl: wsdlContent,
							filtered: false,
							message: 'Herhangi bir method/alan kuralı tanımlanmadı.',
						},
						pairedItem: { item: itemIndex },
					});
					continue;
				}

				let filteredWsdl = wsdlContent;

				// 1) Method (operation) kaldırma - String tabanlı regex ile
				if (operationsToRemove.length > 0) {
					for (const opName of operationsToRemove) {
						// xs:element (Operation ve OperationResponse) kaldır
						// Örn: <xs:element name="QueryInvoice">...</xs:element>
						const operationElementRegex = new RegExp(
							`<xs:element\\s+name="${opName}"[^>]*>.*?</xs:element>`,
							'gs',
						);
						filteredWsdl = filteredWsdl.replace(operationElementRegex, '');

						// Response element'i kaldır
						const responseElementRegex = new RegExp(
							`<xs:element\\s+name="${opName}Response"[^>]*>.*?</xs:element>`,
							'gs',
						);
						filteredWsdl = filteredWsdl.replace(responseElementRegex, '');

						// wsdl:message kaldır (Input ve Output)
						const inputMessageRegex = new RegExp(
							`<wsdl:message\\s+name="[^"]*_${opName}_InputMessage"[^>]*>.*?</wsdl:message>`,
							'gs',
						);
						filteredWsdl = filteredWsdl.replace(inputMessageRegex, '');

						const outputMessageRegex = new RegExp(
							`<wsdl:message\\s+name="[^"]*_${opName}_OutputMessage"[^>]*>.*?</wsdl:message>`,
							'gs',
						);
						filteredWsdl = filteredWsdl.replace(outputMessageRegex, '');

						// wsdl:portType / wsdl:operation kaldır
						const portTypeOperationRegex = new RegExp(
							`<wsdl:operation\\s+name="${opName}"[^>]*>.*?</wsdl:operation>`,
							'gs',
						);
						filteredWsdl = filteredWsdl.replace(portTypeOperationRegex, '');

						// wsdl:binding / wsdl:operation kaldır
						const bindingOperationRegex = new RegExp(
							`<wsdl:operation\\s+name="${opName}"[^>]*>.*?</wsdl:operation>`,
							'gs',
						);
						filteredWsdl = filteredWsdl.replace(bindingOperationRegex, '');
					}
				}

				// 2) Belirli method içinden alan kaldırma - Regex ile
				if (fieldRules.length > 0) {
					for (const rule of fieldRules) {
						const requestTypeName = `${rule.operation}Request`;
						// QueryInvoiceRequest complexType içindeki SupplierCode element'ini bul ve kaldır
						// Önce complexType'ı bul (data contract namespace'de)
						const complexTypeRegex = new RegExp(
							`(<xs:complexType\\s+name="${requestTypeName}"[^>]*>)(.*?)(</xs:complexType>)`,
							'gs',
						);

						filteredWsdl = filteredWsdl.replace(
							complexTypeRegex,
							(_match: string, openTag: string, content: string, closeTag: string) => {
								// İçerikteki xs:sequence'i bul
								const sequenceRegex = new RegExp(`(<xs:sequence[^>]*>)(.*?)(</xs:sequence>)`, 'gs');

								const updatedContent = content.replace(
									sequenceRegex,
									(_seqMatch: string, seqOpen: string, seqContent: string, seqClose: string) => {
										// Field element'ini kaldır (self-closing veya açık/kapalı tag)
										// Önce self-closing tag'i kontrol et
										const selfClosingRegex = new RegExp(
											`<xs:element[^>]*name="${rule.field}"[^>]*/>`,
											'g',
										);
										let cleanedSeqContent = seqContent.replace(selfClosingRegex, '');

										// Eğer açık/kapalı tag formatındaysa (genelde olmaz ama güvenlik için)
										const openCloseRegex = new RegExp(
											`<xs:element[^>]*name="${rule.field}"[^>]*>.*?</xs:element>`,
											'gs',
										);
										cleanedSeqContent = cleanedSeqContent.replace(openCloseRegex, '');

										return `${seqOpen}${cleanedSeqContent}${seqClose}`;
									},
								);

								return `${openTag}${updatedContent}${closeTag}`;
							},
						);
					}
				}

				returnData.push({
					json: {
						...(items[itemIndex].json ?? {}),
						wsdl: filteredWsdl,
						filtered: true,
						removedOperations: operationsToRemove,
						fieldRules,
					},
					pairedItem: { item: itemIndex },
				});
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
