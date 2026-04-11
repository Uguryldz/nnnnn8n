import type {
	IExecuteFunctions,
	IDataObject,
	INodeExecutionData,
	INodeProperties,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

// Helper fonksiyon
function escapeXml(value: string | undefined | null): string {
	return (value || '')
		.replace(/&/g, '&amp;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&apos;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;');
}

export class SoapWsdlCreator implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'SOAP WSDL Creator',
		name: 'soapWsdlCreator',
		icon: 'file:soapWsdlCreator.svg',
		group: ['transform'],
		version: 1,
		description: "XSD Schema'dan WSDL dosyası oluşturur",
		defaults: {
			name: 'SOAP WSDL Creator',
		},
		inputs: ['main'],
		outputs: ['main'],
		properties: [
			{
				displayName: 'XSD Property Name',
				name: 'xsdPropertyName',
				type: 'string',
				default: 'xsd',
				description: 'XSD içeriğinin bulunduğu property adı',
				required: true,
			},
			{
				displayName: 'Service Name',
				name: 'serviceName',
				type: 'string',
				default: 'DynamicService',
				description: 'WSDL service adı',
				required: true,
			},
			{
				displayName: 'Port Type Name',
				name: 'portTypeName',
				type: 'string',
				default: 'DynamicPortType',
				description: 'WSDL port type adı',
			},
			{
				displayName: 'SOAP 1.1 Port Location',
				name: 'soap11Location',
				type: 'string',
				default: 'http://localhost:5678/webhook-test/dynamic.wsdl',
				description: 'SOAP 1.1 port adresi',
			},
			{
				displayName: 'SOAP 1.2 Port Location',
				name: 'soap12Location',
				type: 'string',
				default: 'http://localhost:5678/webhook-test/dynamic.wsdl',
				description: 'SOAP 1.2 port adresi',
			},
			{
				displayName: 'Include SOAP 1.1 Binding',
				name: 'includeSoap11',
				type: 'boolean',
				default: true,
				description: 'SOAP 1.1 binding ekle',
			},
			{
				displayName: 'Include SOAP 1.2 Binding',
				name: 'includeSoap12',
				type: 'boolean',
				default: true,
				description: 'SOAP 1.2 binding ekle',
			},
			{
				displayName: 'Output Property Name',
				name: 'outputPropertyName',
				type: 'string',
				default: 'wsdl',
				description: 'WSDL çıktısının saklanacağı property adı',
			},
		] as INodeProperties[],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
			try {
				const xsdPropertyName = this.getNodeParameter(
					'xsdPropertyName',
					itemIndex,
					'xsd',
				) as string;
				const serviceName = this.getNodeParameter(
					'serviceName',
					itemIndex,
					'DynamicService',
				) as string;
				const portTypeName = this.getNodeParameter(
					'portTypeName',
					itemIndex,
					'DynamicPortType',
				) as string;
				const soap11Location = this.getNodeParameter(
					'soap11Location',
					itemIndex,
					'http://localhost:5678/webhook-test/dynamic.wsdl',
				) as string;
				const soap12Location = this.getNodeParameter(
					'soap12Location',
					itemIndex,
					'http://localhost:5678/webhook-test/dynamic.wsdl',
				) as string;
				const includeSoap11 = this.getNodeParameter('includeSoap11', itemIndex, true) as boolean;
				const includeSoap12 = this.getNodeParameter('includeSoap12', itemIndex, true) as boolean;
				const outputPropertyName = this.getNodeParameter(
					'outputPropertyName',
					itemIndex,
					'wsdl',
				) as string;

				// XSD içeriğini al
				const itemData = items[itemIndex]?.json;
				if (!itemData) {
					throw new NodeOperationError(this.getNode(), 'Input verisi bulunamadı', {
						itemIndex,
					});
				}

				let xsdContent = (itemData[xsdPropertyName] as string) || '';
				if (!xsdContent) {
					throw new NodeOperationError(
						this.getNode(),
						`XSD içeriği bulunamadı. '${xsdPropertyName}' property'sini kontrol edin.`,
						{
							itemIndex,
						},
					);
				}

				// XML deklarasyon ve BOM / boşluk temizle
				xsdContent = xsdContent
					.replace(/^\s*<\?xml.*?\?>\s*/i, '') // <?xml ... ?> sil
					.replace(/^\uFEFF/, '') // BOM sil
					.trim(); // baş/son boşluk sil

				// XSD içinden targetNamespace çek
				const targetNamespaceMatch = xsdContent.match(/targetNamespace=["']([^"']+)["']/);
				const tns = targetNamespaceMatch ? targetNamespaceMatch[1] : 'http://u.instance.com/schema';

				// Sadece top-level xs:elementleri bul
				const topLevelMatches = [
					...xsdContent.matchAll(/<xs:element\s+name=["']([^"']+)["']\s*>/g),
				];
				const topLevelNames = topLevelMatches.map((m) => m[1]);

				if (topLevelNames.length === 0) {
					throw new NodeOperationError(this.getNode(), 'XSD içinde top-level element bulunamadı', {
						itemIndex,
					});
				}

				// Request ve Response elementlerini ayır
				const requests = topLevelNames.filter((n) => !n.endsWith('Response'));
				let responses = topLevelNames.filter((n) => n.endsWith('Response'));

				// Response eksikse otomatik ekle
				while (responses.length < requests.length) {
					responses.push(requests[responses.length] + 'Response');
				}

				// Mesaj, operation ve binding oluştur
				let messages = '';
				let operations = '';
				let soapBinding11 = '';
				let soapBinding12 = '';

				for (let i = 0; i < requests.length; i++) {
					const req = escapeXml(requests[i]);
					const res = escapeXml(responses[i]);

					messages += `  <wsdl:message name="${req}SoapIn">
    <wsdl:part name="parameters" element="tns:${req}"/>
  </wsdl:message>
  <wsdl:message name="${req}SoapOut">
    <wsdl:part name="parameters" element="tns:${res}"/>
  </wsdl:message>\n`;

					operations += `    <wsdl:operation name="${req}">
      <wsdl:input message="tns:${req}SoapIn"/>
      <wsdl:output message="tns:${req}SoapOut"/>
    </wsdl:operation>\n`;

					if (includeSoap11) {
						soapBinding11 += `    <wsdl:operation name="${req}">
      <soap:operation soapAction="${escapeXml(tns)}/${req}" style="document"/>
      <wsdl:input><soap:body use="literal"/></wsdl:input>
      <wsdl:output><soap:body use="literal"/></wsdl:output>
    </wsdl:operation>\n`;
					}

					if (includeSoap12) {
						soapBinding12 += `    <wsdl:operation name="${req}">
      <soap12:operation soapAction="${escapeXml(tns)}/${req}" style="document"/>
      <wsdl:input><soap12:body use="literal"/></wsdl:input>
      <wsdl:output><soap12:body use="literal"/></wsdl:output>
    </wsdl:operation>\n`;
					}
				}

				// WSDL oluştur
				let wsdl = `<?xml version="1.0" encoding="UTF-8"?>
<wsdl:definitions 
    name="${escapeXml(serviceName)}"
    targetNamespace="${escapeXml(tns)}"
    xmlns:wsdl="http://schemas.xmlsoap.org/wsdl/"
    xmlns:soap="http://schemas.xmlsoap.org/wsdl/soap/"
    xmlns:soap12="http://schemas.xmlsoap.org/wsdl/soap12/"
    xmlns:tns="${escapeXml(tns)}"
    xmlns:xsd="http://www.w3.org/2001/XMLSchema">

  <wsdl:types>
    ${xsdContent}
  </wsdl:types>

${messages}
  <wsdl:portType name="${escapeXml(portTypeName)}">
${operations}  </wsdl:portType>

`;

				// SOAP 1.1 Binding
				if (includeSoap11) {
					wsdl += `  <wsdl:binding name="Soap11Binding" type="tns:${escapeXml(portTypeName)}">
    <soap:binding transport="http://schemas.xmlsoap.org/soap/http" style="document"/>
${soapBinding11}  </wsdl:binding>

`;
				}

				// SOAP 1.2 Binding
				if (includeSoap12) {
					wsdl += `  <wsdl:binding name="Soap12Binding" type="tns:${escapeXml(portTypeName)}">
    <soap12:binding transport="http://schemas.xmlsoap.org/soap/http" style="document"/>
${soapBinding12}  </wsdl:binding>

`;
				}

				// Service
				wsdl += `  <wsdl:service name="${escapeXml(serviceName)}">
`;
				if (includeSoap11) {
					wsdl += `    <wsdl:port name="Soap11Port" binding="tns:Soap11Binding">
      <soap:address location="${escapeXml(soap11Location)}"/>
    </wsdl:port>
`;
				}
				if (includeSoap12) {
					wsdl += `    <wsdl:port name="Soap12Port" binding="tns:Soap12Binding">
      <soap12:address location="${escapeXml(soap12Location)}"/>
    </wsdl:port>
`;
				}
				wsdl += `  </wsdl:service>

</wsdl:definitions>`;

				// Output oluştur
				const newItem: IDataObject = {
					...(items[itemIndex]?.json ?? {}),
					[outputPropertyName]: wsdl,
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

export default SoapWsdlCreator;
