import type {
	IExecuteFunctions,
	IDataObject,
	INodeExecutionData,
	INodeProperties,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

interface IFieldDefinition {
	path: string[];
	type: string;
	required: boolean;
}

interface ITreeNode {
	[key: string]: {
		type?: string;
		required?: boolean;
		children?: ITreeNode;
	};
}

// Helper fonksiyonlar
function safe(value: string | undefined | null): string {
	return (value || '').replace(/[^a-zA-Z0-9_]/g, '_');
}

function escapeXml(value: string | undefined | null): string {
	return (value || '')
		.replace(/&/g, '&amp;')
		.replace(/"/g, '&quot;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;');
}

function buildTree(fields: IFieldDefinition[]): ITreeNode {
	const tree: ITreeNode = {};
	for (const field of fields) {
		let current = tree;
		for (let i = 0; i < field.path.length; i++) {
			const pathPart = field.path[i];
			if (i === field.path.length - 1) {
				// Leaf element
				current[pathPart] = {
					type: field.type,
					required: field.required,
				};
			} else {
				// Container element
				if (!current[pathPart]) {
					current[pathPart] = { children: {} };
				}
				if (!current[pathPart].children) {
					current[pathPart].children = {};
				}
				current = current[pathPart].children!;
			}
		}
	}
	return tree;
}

function buildXsd(tree: ITreeNode, indentLevel: number): string {
	let xml = '';
	const indent = ' '.repeat(indentLevel);

	for (const key in tree) {
		const value = tree[key];
		if (value.children) {
			// Container elementler: element tanımı ve içinde sequence
			xml += `${indent}<xs:element name="${escapeXml(key)}">\n`;
			xml += `${indent}  <xs:complexType>\n`;
			xml += `${indent}    <xs:sequence>\n`;
			xml += buildXsd(value.children, indentLevel + 4);
			xml += `${indent}    </xs:sequence>\n`;
			xml += `${indent}  </xs:complexType>\n`;
			xml += `${indent}</xs:element>\n`;
		} else if (value.type) {
			// Leaf elementler: minOccurs ile zorunluluk
			const minOccurs = value.required ? '1' : '0';
			xml += `${indent}<xs:element name="${escapeXml(key)}" type="xs:${value.type}" minOccurs="${minOccurs}"/>\n`;
		}
	}
	return xml;
}

export class WorkflowToXsdSchemaCreator implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'SOAP Workflow to XSD Schema Creator',
		name: 'soapWorkflowToXsdSchemaCreator',
		icon: 'file:workflowToXsdSchema.svg',
		group: ['transform'],
		version: 1,
		description: 'Workflow verilerinden XSD Schema oluşturur',
		defaults: {
			name: 'SOAP Workflow to XSD Schema',
		},
		inputs: ['main'],
		outputs: ['main'],
		properties: [
			{
				displayName: 'Target Namespace',
				name: 'targetNamespace',
				type: 'string',
				default: 'http://u.instance.com/schema',
				description: 'XSD schema için target namespace',
				required: true,
			},
			{
				displayName: 'Default Namespace',
				name: 'defaultNamespace',
				type: 'string',
				default: 'http://u.instance.com/schema',
				description: 'XSD schema için default namespace',
				required: true,
			},
			{
				displayName: 'Use Wrapper Element',
				name: 'useWrapper',
				type: 'boolean',
				default: false,
				description: 'Request elementlerini wrapper element içine al',
			},
			{
				displayName: 'Wrapper Element Name',
				name: 'wrapperElementName',
				type: 'string',
				default: 'request',
				description: 'Wrapper element adı (örn: request)',
				displayOptions: {
					show: {
						useWrapper: [true],
					},
				},
			},
			{
				displayName: 'Wrapper Namespace',
				name: 'wrapperNamespace',
				type: 'string',
				default: 'http://tempuri.org/',
				description: 'Wrapper element için namespace (örn: http://tempuri.org/)',
				displayOptions: {
					show: {
						useWrapper: [true],
					},
				},
			},
			{
				displayName: 'Response Elements',
				name: 'includeResponse',
				type: 'boolean',
				default: true,
				description: 'Response elementlerini ekle',
			},
			{
				displayName: 'Response Status Element',
				name: 'responseStatusElement',
				type: 'string',
				default: 'status',
				description: 'Response status element adı',
				displayOptions: {
					show: {
						includeResponse: [true],
					},
				},
			},
			{
				displayName: 'Response Message Element',
				name: 'responseMessageElement',
				type: 'string',
				default: 'message',
				description: 'Response message element adı',
				displayOptions: {
					show: {
						includeResponse: [true],
					},
				},
			},
			{
				displayName: 'Output Property Name',
				name: 'outputPropertyName',
				type: 'string',
				default: 'xsd',
				description: 'XSD çıktısının saklanacağı property adı',
			},
		] as INodeProperties[],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		// Tüm item'lar için ortak parametreleri al (ilk item'dan)
		const targetNamespace = this.getNodeParameter('targetNamespace', 0) as string;
		const defaultNamespace = this.getNodeParameter('defaultNamespace', 0) as string;
		const useWrapper = this.getNodeParameter('useWrapper', 0, false) as boolean;
		const wrapperElementName = this.getNodeParameter('wrapperElementName', 0, 'request') as string;
		const wrapperNamespace = this.getNodeParameter(
			'wrapperNamespace',
			0,
			'http://tempuri.org/',
		) as string;
		const includeResponse = this.getNodeParameter('includeResponse', 0, true) as boolean;
		const responseStatusElement = this.getNodeParameter(
			'responseStatusElement',
			0,
			'status',
		) as string;
		const responseMessageElement = this.getNodeParameter(
			'responseMessageElement',
			0,
			'message',
		) as string;
		const outputPropertyName = this.getNodeParameter('outputPropertyName', 0, 'xsd') as string;

		// XSD başlangıcı
		let xsd =
			'<?xml version="1.0" encoding="UTF-8"?>\n' +
			`<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema" ` +
			`targetNamespace="${escapeXml(targetNamespace)}" ` +
			`xmlns="${escapeXml(defaultNamespace)}" ` +
			`elementFormDefault="qualified">\n`;

		// Wrapper namespace için import ekle (farklıysa)
		if (useWrapper && wrapperNamespace !== targetNamespace) {
			xsd += `  <xs:import namespace="${escapeXml(wrapperNamespace)}" schemaLocation=""/>\n`;
		}

		// Tüm workflow'ları işle (her item bir workflow)
		for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
			try {
				const workflowData = items[itemIndex]?.json;
				if (!workflowData) {
					continue;
				}

				const wfName = String(workflowData.name || 'UnnamedWorkflow');
				const procName = safe(wfName);

				// Node'lardan field'ları topla
				const fields: IFieldDefinition[] = [];
				if (workflowData.nodes && Array.isArray(workflowData.nodes)) {
					workflowData.nodes.forEach((node: IDataObject) => {
						if (node.notes) {
							const lines = String(node.notes)
								.split('\n')
								.filter((l: string) => l.trim().startsWith('@'));
							for (const line of lines) {
								const parts = line.trim().split(/\s+/);
								if (parts.length >= 3) {
									const [, name, type, required] = parts;
									if (name && type) {
										fields.push({
											path: name.split('.'),
											type: type || 'string',
											required: required === 'required',
										});
									}
								}
							}
						}
					});
				}

				// Nested tree yapısını oluştur
				const tree = buildTree(fields);

				// Request element
				xsd += `  <xs:element name="${escapeXml(procName)}">\n`;
				xsd += `    <xs:complexType>\n`;
				xsd += `      <xs:sequence>\n`;

				if (useWrapper) {
					// Wrapper element ekle
					xsd += `        <xs:element name="${escapeXml(wrapperElementName)}" minOccurs="0">\n`;
					xsd += `          <xs:complexType>\n`;
					xsd += `            <xs:sequence>\n`;
					xsd += buildXsd(tree, 6);
					xsd += `            </xs:sequence>\n`;
					xsd += `          </xs:complexType>\n`;
					xsd += `        </xs:element>\n`;
				} else {
					// Direkt field'ları ekle
					xsd += buildXsd(tree, 4);
				}

				xsd += `      </xs:sequence>\n`;
				xsd += `    </xs:complexType>\n`;
				xsd += `  </xs:element>\n`;

				// Response element
				if (includeResponse) {
					xsd += `  <xs:element name="${escapeXml(procName)}Response">\n`;
					xsd += `    <xs:complexType>\n`;
					xsd += `      <xs:sequence>\n`;
					xsd += `        <xs:element name="${escapeXml(
						responseStatusElement,
					)}" type="xs:string"/>\n`;
					xsd += `        <xs:element name="${escapeXml(
						responseMessageElement,
					)}" type="xs:string" minOccurs="0"/>\n`;
					xsd += `      </xs:sequence>\n`;
					xsd += `    </xs:complexType>\n`;
					xsd += `  </xs:element>\n`;
				}
			} catch (error) {
				if (this.continueOnFail()) {
					// Hata durumunda devam et
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

		xsd += '</xs:schema>';

		// Tüm workflow'lar için tek bir output oluştur
		const newItem: IDataObject = {
			[outputPropertyName]: xsd,
		};

		returnData.push({
			json: newItem,
		});

		return [returnData];
	}
}

export default WorkflowToXsdSchemaCreator;
