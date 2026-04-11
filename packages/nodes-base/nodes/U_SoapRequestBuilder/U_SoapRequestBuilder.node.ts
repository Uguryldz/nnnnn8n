import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import * as xpath from 'xpath';
import type {
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

/**
 * XML'i güzel formatlar (indent ekler)
 */
function formatXml(xml: string, indent: string = '   '): string {
	let formatted = '';
	let level = 0;
	const tokens = xml.match(/<[^>]+>|[^<]+/g) || [];

	for (let i = 0; i < tokens.length; i++) {
		const token = tokens[i].trim();
		if (!token) continue;

		if (token.startsWith('</')) {
			// Closing tag
			level--;
			// Eğer önceki karakter newline değilse, text content vardır
			if (formatted.endsWith('\n')) {
				formatted += indent.repeat(Math.max(0, level)) + token + '\n';
			} else {
				// Text content ile aynı satırda
				formatted += token + '\n';
			}
		} else if (token.startsWith('<?') || token.startsWith('<!')) {
			// XML declaration or comment
			formatted += token + '\n';
		} else if (token.endsWith('/>')) {
			// Self-closing tag
			formatted += indent.repeat(level) + token + '\n';
		} else if (token.startsWith('<')) {
			// Opening tag
			formatted += indent.repeat(level) + token;
			// Bir sonraki token'a bak
			const nextToken = i + 1 < tokens.length ? tokens[i + 1].trim() : '';
			if (nextToken && !nextToken.startsWith('<')) {
				// Text content var, newline ekleme, text ile aynı satırda
			} else {
				formatted += '\n';
			}
			level++;
		} else {
			// Text content - trimle ama satır yapısını koru
			const trimmedText = token.trim();
			formatted += trimmedText;
		}
	}

	return formatted.trim();
}

/**
 * SOAP XML'den boş/null/? değerli elementleri ve Optional yorumlarını temizler
 */
function cleanSoapXml(xml: string): string {
	try {
		// Önce <!--Optional:--> yorumlarını kaldır
		let cleaned = xml.replace(/<!--Optional:-->/gi, '');

		// XML'i parse et
		const dom = new DOMParser().parseFromString(cleaned, 'text/xml');

		// Parse hatası kontrolü
		const parseError = dom.getElementsByTagName('parsererror');
		if (parseError.length > 0) {
			const errorText = parseError[0].textContent || 'Bilinmeyen XML parse hatası';
			throw new Error('XML parse hatası: ' + errorText);
		}

		// Önce tüm text node'ları trimle
		const textNodes = xpath.select('//text()', dom) as any[];
		for (let i = 0; i < textNodes.length; i++) {
			const textNode = textNodes[i];
			if (textNode && textNode.nodeType === 3) {
				// Text node içeriğini trimle
				const trimmedText = textNode.data ? String(textNode.data).trim() : '';
				textNode.data = trimmedText;
			}
		}

		// Tüm elementleri seç (geriye doğru döngü için)
		const nodes = xpath.select('//*', dom) as any[];

		// Geriye doğru döngü (removeChild sırasında index kaymasını önlemek için)
		for (let i = nodes.length - 1; i >= 0; i--) {
			const node = nodes[i];
			if (!node || !node.parentNode) continue;

			// Element'in içeriğini kontrol et
			let hasValidContent = false;
			let isEmptyOrInvalid = true;

			// Tüm child node'ları kontrol et
			for (let j = 0; j < node.childNodes.length; j++) {
				const child = node.childNodes[j];

				if (child.nodeType === 1) {
					// Element node - içerik var, bu element kalsın
					hasValidContent = true;
					isEmptyOrInvalid = false;
					break;
				} else if (child.nodeType === 3) {
					// Text node
					const text = child.data ? String(child.data).trim() : '';
					if (text !== '' && text !== 'null' && text !== '?') {
						// Geçerli içerik var
						hasValidContent = true;
						isEmptyOrInvalid = false;
						break;
					}
				}
				// Comment (8) ve diğer node tipleri ignore edilir
			}

			// Eğer hiç child yoksa veya sadece boş/null/? değerler varsa kaldır
			if (!hasValidContent && (node.childNodes.length === 0 || isEmptyOrInvalid)) {
				if (node.parentNode) {
					node.parentNode.removeChild(node);
				}
			}
		}

		// Temiz XML'i string olarak döndür
		let result = new XMLSerializer().serializeToString(dom);

		// Gereksiz boş satırları temizle (2+ boş satırı tek boş satıra indir)
		result = result.replace(/\n\s*\n\s*\n+/g, '\n\n');

		// Formatla (indent ekle, text content'leri trimle)
		result = formatXml(result);

		// Son temizlik: başta ve sonda gereksiz boşlukları kaldır
		result = result.trim();

		return result;
	} catch (error) {
		throw new Error(
			'SOAP XML temizleme hatası: ' + (error instanceof Error ? error.message : String(error)),
		);
	}
}

export class U_SoapRequestBuilder implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'U_SOAP Request Builder',
		name: 'uSoapRequestBuilder',
		icon: 'fa:code',
		group: ['transform'],
		version: 1,
		description:
			'SOAP XML içindeki boş/null/? değerli elementleri ve Optional yorumlarını temizler',
		defaults: {
			name: 'U_SOAP Request Builder',
		},
		inputs: ['main'],
		outputs: ['main'],
		properties: [
			{
				displayName: 'Input XML',
				name: 'inputXml',
				type: 'string',
				typeOptions: {
					rows: 15,
				},
				default: '',
				required: true,
				description:
					'SOAP XML içeriği. Boş/null/? değerli elementler ve Optional yorumları otomatik olarak temizlenecektir.',
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];
		const node = this.getNode();

		for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
			try {
				// Input XML'i al
				let inputXml = this.getNodeParameter('inputXml', itemIndex) as string;

				// Eğer parametre boşsa, item'dan al
				if (!inputXml || inputXml.trim() === '') {
					// Item'dan inputXml, xml, soapEnvelope veya soapRequest alanını kontrol et
					const itemJson = items[itemIndex]?.json ?? {};
					inputXml =
						(itemJson.inputXml as string) ||
						(itemJson.xml as string) ||
						(itemJson.soapEnvelope as string) ||
						(itemJson.soapRequest as string) ||
						'';
				}

				if (!inputXml || inputXml.trim() === '') {
					throw new NodeOperationError(
						node,
						`Item ${itemIndex + 1}: Input XML içeriği boş olamaz.`,
					);
				}

				// SOAP XML'i temizle
				const cleanedXml = cleanSoapXml(inputXml);

				const baseJson = items[itemIndex]?.json ?? {};
				const outputItem: INodeExecutionData = {
					json: {
						...baseJson,
						xml: cleanedXml,
					},
					pairedItem: { item: itemIndex },
				};

				returnData.push(outputItem);
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
