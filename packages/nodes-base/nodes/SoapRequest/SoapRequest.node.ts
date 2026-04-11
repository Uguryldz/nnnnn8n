import type {
	IExecuteFunctions,
	IDataObject,
	IHttpRequestOptions,
	INodeExecutionData,
	INodeProperties,
	INodeType,
	INodeTypeDescription,
	JsonObject,
} from 'n8n-workflow';
import { NodeOperationError, removeCircularRefs } from 'n8n-workflow';
import { XMLParser } from 'fast-xml-parser';

export class SoapRequest implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'SOAP Request',
		name: 'soapRequest',
		icon: 'file:soapRequest.svg',
		group: ['transform'],
		version: 1,
		description: 'Send SOAP requests to arbitrary endpoints',
		defaults: {
			name: 'SOAP Request',
		},
		inputs: ['main'],
		outputs: ['main'],
		usableAsTool: true,
		credentials: [
			{
				name: 'soapBasicAuthApi',
				required: true,
				displayOptions: {
					show: {
						authentication: ['basicAuth'],
					},
				},
			},
		],
		properties: [
			{
				displayName: 'Resource',
				name: 'resource',
				type: 'options',
				noDataExpression: true,
				options: [
					{
						name: 'Request',
						value: 'request',
					},
				],
				default: 'request',
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: {
					show: {
						resource: ['request'],
					},
				},
				options: [
					{
						name: 'Send SOAP Request',
						value: 'sendRequest',
						action: 'Send a SOAP request',
					},
				],
				default: 'sendRequest',
			},
			{
				displayName: 'Endpoint',
				name: 'endpoint',
				type: 'string',
				required: true,
				default: '',
				placeholder: 'https://example.com/soap',
				description: 'The SOAP endpoint URL to send the request to',
				displayOptions: {
					show: {
						resource: ['request'],
						operation: ['sendRequest'],
					},
				},
			},
			{
				displayName: 'SOAP Version',
				name: 'soapVersion',
				type: 'options',
				default: '1.1',
				options: [
					{
						name: '1.1',
						value: '1.1',
					},
					{
						name: '1.2',
						value: '1.2',
					},
				],
				displayOptions: {
					show: {
						resource: ['request'],
						operation: ['sendRequest'],
					},
				},
			},
			{
				displayName: 'HTTP Method',
				name: 'httpMethod',
				type: 'options',
				default: 'POST',
				options: [
					{
						name: 'POST',
						value: 'POST',
					},
					{
						name: 'GET',
						value: 'GET',
					},
				],
				description: 'HTTP verb to use for the request (POST is recommended for SOAP)',
				displayOptions: {
					show: {
						resource: ['request'],
						operation: ['sendRequest'],
					},
				},
			},
			{
				displayName: 'SOAP Action',
				name: 'soapAction',
				type: 'string',
				default: '',
				description: 'Optional SOAPAction header value. Required by many SOAP 1.1 services.',
				displayOptions: {
					show: {
						resource: ['request'],
						operation: ['sendRequest'],
					},
				},
			},
			{
				displayName: 'SOAP Envelope',
				name: 'soapEnvelope',
				type: 'string',
				typeOptions: {
					alwaysOpenEditWindow: true,
					rows: 20,
				},
				default: '',
				placeholder:
					'<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ns="http://example.com/">\n  <soapenv:Header/>\n  <soapenv:Body>\n    <ns:MyRequest>\n      <ns:Value>={{$json.value}}</ns:Value>\n    </ns:MyRequest>\n  </soapenv:Body>\n</soapenv:Envelope>',
				description: 'Full SOAP envelope XML payload to send to the endpoint',
				displayOptions: {
					show: {
						resource: ['request'],
						operation: ['sendRequest'],
					},
				},
			},
			{
				displayName: 'Authentication',
				name: 'authentication',
				type: 'options',
				options: [
					{
						name: 'None',
						value: 'none',
					},
					{
						name: 'Basic Auth',
						value: 'basicAuth',
					},
				],
				default: 'none',
				displayOptions: {
					show: {
						resource: ['request'],
						operation: ['sendRequest'],
					},
				},
			},
			{
				displayName: 'Request Headers',
				name: 'headers',
				type: 'fixedCollection',
				placeholder: 'Add Header',
				typeOptions: {
					multipleValues: true,
				},
				options: [
					{
						name: 'header',
						displayName: 'Header',
						values: [
							{
								displayName: 'Name',
								name: 'name',
								type: 'string',
								default: '',
							},
							{
								displayName: 'Value',
								name: 'value',
								type: 'string',
								default: '',
							},
						],
					},
				],
				default: {},
				displayOptions: {
					show: {
						resource: ['request'],
						operation: ['sendRequest'],
					},
				},
			},
			{
				displayName: 'Query Parameters',
				name: 'queryParameters',
				type: 'fixedCollection',
				placeholder: 'Add Parameter',
				typeOptions: {
					multipleValues: true,
				},
				options: [
					{
						name: 'parameter',
						displayName: 'Parameter',
						values: [
							{
								displayName: 'Name',
								name: 'name',
								type: 'string',
								default: '',
							},
							{
								displayName: 'Value',
								name: 'value',
								type: 'string',
								default: '',
							},
						],
					},
				],
				default: {},
				displayOptions: {
					show: {
						resource: ['request'],
						operation: ['sendRequest'],
					},
				},
			},
			{
				displayName: 'Options',
				name: 'options',
				type: 'collection',
				default: {},
				placeholder: 'Add Option',
				options: [
					{
						displayName: 'Ignore SSL Issues',
						name: 'ignoreSslIssues',
						type: 'boolean',
						default: false,
						description: 'Whether to allow insecure SSL certificates',
					},
					{
						displayName: 'Include Headers',
						name: 'includeHeaders',
						type: 'boolean',
						default: false,
						description: 'Whether to include response headers in the output',
					},
					{
						displayName: 'Include Status Code',
						name: 'includeStatusCode',
						type: 'boolean',
						default: true,
						description: 'Whether to include HTTP status code in the output',
					},
					{
						displayName: 'Response Format',
						name: 'responseFormat',
						type: 'options',
						default: 'text',
						options: [
							{
								name: 'JSON (parsed)',
								value: 'json',
							},
							{
								name: 'Text',
								value: 'text',
							},
						],
						description: 'Whether to parse the SOAP XML into JSON before returning the response',
					},
					{
						displayName: 'Output Property Name',
						name: 'outputPropertyName',
						type: 'string',
						default: 'soapResponse',
						description: 'The name of the property to store the response data in the output item',
					},
				],
				displayOptions: {
					show: {
						resource: ['request'],
						operation: ['sendRequest'],
					},
				},
			},
		] as INodeProperties[],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];
		const xmlParser = new XMLParser({
			ignoreAttributes: false,
			attributeNamePrefix: '@_',
			ignoreDeclaration: false,
		});

		for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
			try {
				const endpoint = this.getNodeParameter('endpoint', itemIndex, '') as string;
				const soapVersion = this.getNodeParameter('soapVersion', itemIndex) as string;
				const httpMethod = this.getNodeParameter('httpMethod', itemIndex) as 'GET' | 'POST';
				const soapAction = this.getNodeParameter('soapAction', itemIndex, '') as string;
				const soapEnvelope = this.getNodeParameter('soapEnvelope', itemIndex, '') as string;
				const authentication = this.getNodeParameter('authentication', itemIndex) as string;

				const headerCollectionRaw = this.getNodeParameter(
					'headers.header',
					itemIndex,
					[],
				) as IDataObject[];
				const queryCollectionRaw = this.getNodeParameter(
					'queryParameters.parameter',
					itemIndex,
					[],
				) as IDataObject[];
				const options = this.getNodeParameter('options', itemIndex, {}) as IDataObject;

				if (!soapEnvelope && httpMethod === 'POST') {
					throw new NodeOperationError(
						this.getNode(),
						'SOAP Envelope cannot be empty for POST requests',
						{
							itemIndex,
						},
					);
				}

				const queryParameters: IDataObject = {};
				if (Array.isArray(queryCollectionRaw)) {
					for (const entry of queryCollectionRaw) {
						if (!entry) continue;
						const name = entry.name as string | undefined;
						const value = entry.value as string | undefined;
						if (typeof name === 'string' && name !== '' && typeof value === 'string') {
							queryParameters[name] = value;
						}
					}
				}

				const headers: Record<string, string> = {};
				if (Array.isArray(headerCollectionRaw)) {
					for (const entry of headerCollectionRaw) {
						if (!entry) continue;
						const name = entry.name as string | undefined;
						const value = entry.value as string | undefined;
						if (typeof name === 'string' && name !== '' && typeof value === 'string') {
							headers[name] = value;
						}
					}
				}

				if (!headers['Content-Type']) {
					headers['Content-Type'] =
						soapVersion === '1.2'
							? 'application/soap+xml; charset=utf-8'
							: 'text/xml; charset=utf-8';
				}

				if (soapAction) {
					headers.SOAPAction = soapAction;
				}

				const requestOptions: IHttpRequestOptions = {
					url: endpoint,
					method: httpMethod,
					headers,
					body: soapEnvelope || undefined,
					qs: Object.keys(queryParameters).length ? queryParameters : undefined,
					returnFullResponse: true,
					json: false,
				};

				if (options.ignoreSslIssues === true) {
					requestOptions.skipSslCertificateValidation = true;
				}

				const response =
					authentication === 'basicAuth'
						? await this.helpers.httpRequestWithAuthentication.call(
								this,
								'soapBasicAuthApi',
								requestOptions,
							)
						: await this.helpers.httpRequest(requestOptions);

				const rawBody = response.body ?? response.data ?? '';
				const responseBody =
					typeof rawBody === 'string'
						? rawBody
						: Buffer.isBuffer(rawBody)
							? rawBody.toString('utf8')
							: JSON.stringify(rawBody);
				const responseFormat = (options.responseFormat as string) || 'text';
				const outputPropertyName = (options.outputPropertyName as string) || 'soapResponse';

				let responseData: IDataObject | string = responseBody;

				if (responseFormat === 'json') {
					try {
						responseData = xmlParser.parse(responseBody);
					} catch (error) {
						throw new NodeOperationError(
							this.getNode(),
							'Failed to parse SOAP response to JSON. Check that the service returns valid XML.',
							{
								itemIndex,
								description: (error as Error).message,
							},
						);
					}
				}

				const newItem: IDataObject = {
					...(items[itemIndex]?.json ?? {}),
					[outputPropertyName]: responseData,
				};

				if (options.includeHeaders === true && response.headers) {
					newItem[`${outputPropertyName}Headers`] = response.headers;
				}
				if (options.includeStatusCode !== false && response.statusCode !== undefined) {
					newItem[`${outputPropertyName}StatusCode`] = response.statusCode;
				}

				returnData.push({
					json: newItem,
					pairedItem: {
						item: itemIndex,
					},
				});
			} catch (error) {
				// Hata yanıtını ayrıştır
				let parsedError: JsonObject = {};
				let responseBody = '';
				let statusCode: number | undefined;
				let headers: Record<string, string> | undefined;

				// Error objesinden response body'yi çıkar
				const errorObj = error as any;

				// Axios error formatı
				if (errorObj.response) {
					statusCode = errorObj.response.status || errorObj.response.statusCode;
					headers = errorObj.response.headers;
					const rawBody = errorObj.response.data || errorObj.response.body || '';
					responseBody =
						typeof rawBody === 'string'
							? rawBody
							: Buffer.isBuffer(rawBody)
								? rawBody.toString('utf8')
								: JSON.stringify(rawBody);
				}
				// n8n httpRequest error formatı
				else if (errorObj.body || errorObj.data) {
					statusCode = errorObj.statusCode || errorObj.status;
					headers = errorObj.headers;
					const rawBody = errorObj.body || errorObj.data || '';
					responseBody =
						typeof rawBody === 'string'
							? rawBody
							: Buffer.isBuffer(rawBody)
								? rawBody.toString('utf8')
								: JSON.stringify(rawBody);
				}
				// reason içinde response varsa (n8n error formatı)
				else if (errorObj.reason) {
					const reason = errorObj.reason as any;
					if (reason.response) {
						statusCode = reason.response.status || reason.response.statusCode;
						headers = reason.response.headers;
						const rawBody = reason.response.data || reason.response.body || '';
						responseBody =
							typeof rawBody === 'string'
								? rawBody
								: Buffer.isBuffer(rawBody)
									? rawBody.toString('utf8')
									: JSON.stringify(rawBody);
					} else if (reason.body || reason.data) {
						statusCode = reason.statusCode || reason.status;
						headers = reason.headers;
						const rawBody = reason.body || reason.data || '';
						responseBody =
							typeof rawBody === 'string'
								? rawBody
								: Buffer.isBuffer(rawBody)
									? rawBody.toString('utf8')
									: JSON.stringify(rawBody);
					}
				}

				// Her durumda ham response'u ekle
				if (responseBody && typeof responseBody === 'string' && responseBody.trim() !== '') {
					parsedError.rawResponse = responseBody;
				}

				// SOAP Fault'u parse et
				if (responseBody && typeof responseBody === 'string') {
					// SOAP XML formatında mı kontrol et
					if (
						responseBody.trim().startsWith('<') ||
						responseBody.includes('soap:') ||
						responseBody.includes('soapenv:')
					) {
						// XML formatında olduğu için rawXml olarak da ekle
						parsedError.rawXml = responseBody;

						try {
							const parsedXml = xmlParser.parse(responseBody);

							// SOAP Fault yapısını bul
							const findFault = (obj: any): any => {
								if (!obj || typeof obj !== 'object') return null;

								// Fault objesini ara
								if (obj.Fault || obj.fault || obj.soapFault || obj.soapenvFault) {
									return obj.Fault || obj.fault || obj.soapFault || obj.soapenvFault;
								}

								// Body içinde Fault ara
								if (obj.Body || obj.body || obj.soapBody || obj.soapenvBody) {
									const body = obj.Body || obj.body || obj.soapBody || obj.soapenvBody;
									if (body.Fault || body.fault || body.soapFault || body.soapenvFault) {
										return body.Fault || body.fault || body.soapFault || body.soapenvFault;
									}
								}

								// Envelope içinde ara
								if (obj.Envelope || obj.envelope || obj.soapEnvelope || obj.soapenvEnvelope) {
									const envelope =
										obj.Envelope || obj.envelope || obj.soapEnvelope || obj.soapenvEnvelope;
									if (envelope.Body || envelope.body || envelope.soapBody || envelope.soapenvBody) {
										const body =
											envelope.Body || envelope.body || envelope.soapBody || envelope.soapenvBody;
										if (body.Fault || body.fault || body.soapFault || body.soapenvFault) {
											return body.Fault || body.fault || body.soapFault || body.soapenvFault;
										}
									}
								}

								// Recursive olarak tüm objeyi ara
								for (const key in obj) {
									if (obj.hasOwnProperty(key)) {
										const found = findFault(obj[key]);
										if (found) return found;
									}
								}

								return null;
							};

							const fault = findFault(parsedXml);

							if (fault) {
								parsedError.soapFault = fault;

								// Fault detaylarını ayrıştır
								if (fault.faultcode || fault.faultCode) {
									parsedError.faultcode = fault.faultcode || fault.faultCode;
								}
								if (fault.faultstring || fault.faultString) {
									parsedError.faultstring = fault.faultstring || fault.faultString;
								}
								if (fault.detail || fault.Detail) {
									parsedError.detail = fault.detail || fault.Detail;
								}
							} else {
								// Fault bulunamadı ama XML parse edildi, tüm yapıyı ekle
								parsedError.parsedResponse = parsedXml;
							}
						} catch (parseError) {
							// XML parse edilemedi, parse hatasını ekle ama rawResponse zaten var
							parsedError.parseError = (parseError as Error).message;
						}
					}
				}

				// HTTP hata bilgilerini ekle
				if (statusCode !== undefined) {
					parsedError.statusCode = statusCode;
				}
				if (headers) {
					parsedError.headers = headers;
				}

				// Error mesajını ekle
				if (errorObj.message) {
					parsedError.message = errorObj.message;
				}
				if (errorObj.code) {
					parsedError.code = errorObj.code;
				}

				if (this.continueOnFail()) {
					removeCircularRefs(parsedError);
					// Ayrıştırılmış hata bilgilerini döndür
					returnData.push({
						json: {
							error: parsedError,
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

				// SOAP Fault varsa, daha detaylı hata mesajı oluştur
				if (parsedError.soapFault) {
					const faultMsg =
						parsedError.faultstring || parsedError.faultcode || 'SOAP Fault occurred';
					throw new NodeOperationError(this.getNode(), faultMsg as string, {
						itemIndex,
						description: `SOAP Fault: ${JSON.stringify(parsedError.soapFault)}`,
					});
				}

				throw new NodeOperationError(this.getNode(), error as Error, {
					itemIndex,
				});
			}
		}

		return [returnData];
	}
}
