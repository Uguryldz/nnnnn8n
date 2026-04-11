import {
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	NodeOperationError,
} from 'n8n-workflow';

export class TextFileParser implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'U_Text File Parser',
		name: 'textFileParser',
		icon: 'file:text.svg',
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["operation"]}}',
		description: 'Text dosyalarını oku ve parse et',
		defaults: {
			name: 'U_Text File Parser',
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
						name: 'Content Mapping',
						value: 'contentMapping',
						description: 'Sabit uzunluklu alanları parse et',
						action: 'Map content fields',
					},
					{
						name: 'Parse Text File',
						value: 'parseTextFile',
						description: 'Text dosyasını sabit uzunluklu format ile parse et',
						action: 'Parse a text file',
					},
					{
						name: 'Read Text File',
						value: 'readTextFile',
						description: 'Text dosyasını oku ve içeriğini döndür',
						action: 'Read a text file',
					},
				],
				default: 'readTextFile',
			},
			{
				displayName: 'Input Binary Field',
				name: 'binaryPropertyName',
				type: 'string',
				default: 'data',
				displayOptions: {
					show: {
						operation: ['readTextFile'],
					},
				},
				description: 'Binary data içeren input field adı',
				required: true,
			},
			{
				displayName: 'Source Fields',
				name: 'sourceFields',
				type: 'fixedCollection',
				typeOptions: {
					multipleValues: true,
				},
				displayOptions: {
					show: {
						operation: ['contentMapping'],
					},
				},
				default: {
					field: [
						{
							sourceFieldName: 'content',
							fieldMappings: {
								field: [],
							},
						},
					],
				},
				options: [
					{
						displayName: 'Field',
						name: 'field',
						values: [
							{
								displayName: 'Source Field Name',
								name: 'sourceFieldName',
								type: 'string',
								default: 'content',
								description: 'Kaynak field adı (örn: line, data, header)',
								required: true,
							},
							{
								displayName: 'Field Mappings',
								name: 'fieldMappings',
								type: 'fixedCollection',
								typeOptions: {
									multipleValues: true,
								},
								default: {},
								options: [
									{
										displayName: 'Field',
										name: 'field',
										values: [
											{
												displayName: 'Decimals',
												name: 'decimals',
												type: 'number',
												default: 0,
												description: 'Decimal hane sayısı (sadece Numeric için)',
												displayOptions: {
													show: {
														type: ['N'],
													},
												},
											},
											{
												displayName: 'Field Name',
												name: 'fieldName',
												type: 'string',
												default: '',
												description: 'Field adı (örn: Kayıt Tipi)',
												required: true,
											},
											{
												displayName: 'Length',
												name: 'length',
												type: 'number',
												default: 1,
												description: 'Alan uzunluğu',
												required: true,
											},
											{
												displayName: 'Start Position',
												name: 'startPosition',
												type: 'number',
												default: 0,
												description: 'Başlangıç pozisyonu (0-based index)',
												required: true,
											},
											{
												displayName: 'Type',
												name: 'type',
												type: 'options',
												options: [
													{
														name: 'Alphanumeric',
														value: 'A',
													},
													{
														name: 'Numeric',
														value: 'N',
													},
												],
												default: 'A',
												description: 'Alan tipi',
												required: true,
											},
										],
									},
								],
								description: 'Bu source field için sabit uzunluklu alan tanımlamaları',
								required: true,
							},
						],
					},
				],
				description: 'Kaynak field ve her biri için özel field mapping tanımlamaları',
				required: true,
			},
			{
				displayName: 'Input Text Field',
				name: 'textPropertyName',
				type: 'string',
				default: 'content',
				displayOptions: {
					show: {
						operation: ['parseTextFile'],
					},
				},
				description: 'Text content içeren input field adı (örn: content)',
				required: true,
			},
			{
				displayName: 'Parser Options',
				name: 'parserOptions',
				type: 'collection',
				placeholder: 'Add Field',
				default: {},
				displayOptions: {
					show: {
						operation: ['parseTextFile'],
					},
				},
				options: [
					{
						displayName: 'Footer Starts With',
						name: 'footerStartsWith',
						type: 'string',
						default: 'T',
						displayOptions: {
							show: {
								hasFooter: [true],
							},
						},
						description: 'Character(s) that the footer line starts with (e.g., T)',
					},
					{
						displayName: 'Has Footer',
						name: 'hasFooter',
						type: 'boolean',
						default: false,
						description: 'Whether the file has a footer line',
					},
					{
						displayName: 'Has Header',
						name: 'hasHeader',
						type: 'boolean',
						default: false,
						description: 'Whether the file has a header line',
					},
					{
						displayName: 'Header Starts With',
						name: 'headerStartsWith',
						type: 'string',
						default: 'H',
						displayOptions: {
							show: {
								hasHeader: [true],
							},
						},
						description: 'Character(s) that the header line starts with (e.g., H)',
					},
				],
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnItems: INodeExecutionData[] = [];
		const operation = this.getNodeParameter('operation', 0) as string;

		for (let i = 0; i < items.length; i++) {
			try {
				let fileContent: string | undefined;
				let fileName = 'unknown';

				if (operation === 'readTextFile') {
					// Read from binary data
					const binaryPropertyName = this.getNodeParameter('binaryPropertyName', i) as string;
					const binaryData = this.helpers.assertBinaryData(i, binaryPropertyName);
					fileName = binaryData.fileName || 'unknown';

					if (binaryData.id) {
						// For binary data with ID, get the stream and read it
						const stream = await this.helpers.getBinaryStream(binaryData.id);
						const chunks: Buffer[] = [];

						await new Promise<void>((resolve, reject) => {
							stream.on('data', (chunk: Buffer) => chunks.push(chunk));
							stream.on('end', () => resolve());
							stream.on('error', reject);
						});

						const buffer = Buffer.concat(chunks);
						fileContent = buffer.toString('utf8');
					} else {
						// For binary data without ID, use the data directly
						if (binaryData.data) {
							const buffer = Buffer.from(binaryData.data, 'base64');
							fileContent = buffer.toString('utf8');
						} else {
							throw new NodeOperationError(this.getNode(), 'Binary data is empty');
						}
					}
				} else if (operation === 'parseTextFile') {
					// Parse Text File - read from text content field
					const textPropertyName = this.getNodeParameter('textPropertyName', i) as string;

					// Try to get text content
					let textContent: string | undefined;

					// If textPropertyName is very long (likely resolved expression content), use it directly
					if (textPropertyName.length > 100) {
						textContent = textPropertyName;
					} else {
						// Check if it's a field name in JSON
						if (items[i].json[textPropertyName] !== undefined) {
							textContent = items[i].json[textPropertyName] as string;
						} else {
							// Try common field names as fallback
							if (items[i].json.content) {
								textContent = items[i].json.content as string;
							} else if (items[i].json.text) {
								textContent = items[i].json.text as string;
							} else {
								// If still not found and textPropertyName looks like content, use it
								if (textPropertyName.includes('\n') || textPropertyName.includes('\r')) {
									textContent = textPropertyName;
								} else {
									throw new NodeOperationError(
										this.getNode(),
										`Text content field "${textPropertyName}" not found. Available fields: ${Object.keys(items[i].json).join(', ')}. If using expression like {{ $json.content }}, the expression will be resolved automatically.`,
									);
								}
							}
						}
					}

					if (!textContent || typeof textContent !== 'string') {
						throw new NodeOperationError(
							this.getNode(),
							`Text content is empty or not a string. Available fields: ${Object.keys(items[i].json).join(', ')}`,
						);
					}

					fileContent = textContent;
					// Try to get fileName from json if available
					if (items[i].json.fileName) {
						fileName = items[i].json.fileName as string;
					}
				} else if (operation === 'contentMapping') {
					// Content Mapping doesn't need fileContent here, it will be processed per source field
					// Just set fileName if available
					if (items[i].json.fileName) {
						fileName = items[i].json.fileName as string;
					}
				}

				if (operation === 'readTextFile') {
					if (!fileContent) {
						throw new NodeOperationError(this.getNode(), 'File content is empty');
					}
					const executionData = this.helpers.constructExecutionMetaData(
						[
							{
								json: {
									...items[i].json,
									content: fileContent,
									fileName: fileName,
								},
							},
						],
						{ itemData: { item: i } },
					);
					returnItems.push(...executionData);
				} else if (operation === 'contentMapping') {
					// Get source fields with their own field mappings
					const sourceFields = this.getNodeParameter('sourceFields.field', i, []) as Array<{
						sourceFieldName: string;
						fieldMappings?: {
							field?: Array<{
								fieldName: string;
								startPosition: number;
								length: number;
								type: 'A' | 'N';
								decimals?: number;
							}>;
						};
					}>;

					if (sourceFields.length === 0) {
						throw new NodeOperationError(this.getNode(), 'At least one source field is required');
					}

					// Parse all source fields into a single item
					const mappedData: Record<string, string | number> = {
						fileName: fileName,
					};

					// Process each source field with its own field mappings and merge into single item
					for (const sourceField of sourceFields) {
						const sourceFieldName = sourceField.sourceFieldName;
						const fieldMappings = sourceField.fieldMappings?.field || [];

						if (fieldMappings.length === 0) {
							// Skip this source field if no mappings defined
							continue;
						}

						// Get text content from source field
						// sourceFieldName can be either a field name or resolved expression content
						let textContent: string | undefined;

						// First, check if sourceFieldName is a field name in JSON
						if (items[i].json[sourceFieldName] !== undefined) {
							textContent = items[i].json[sourceFieldName] as string;
						} else {
							// If not found as field name, it might be resolved expression content
							// Check if it looks like content (has spaces, numbers, or is longer than typical field names)
							if (sourceFieldName && typeof sourceFieldName === 'string') {
								// If it contains spaces, numbers, or special chars, it's likely resolved content
								if (
									sourceFieldName.length > 0 &&
									(sourceFieldName.includes(' ') ||
										sourceFieldName.includes('\n') ||
										sourceFieldName.includes('\r') ||
										/[\d\s]/.test(sourceFieldName))
								) {
									textContent = sourceFieldName;
								} else {
									// Try common field names as fallback
									if (items[i].json.content) {
										textContent = items[i].json.content as string;
									} else if (items[i].json.text) {
										textContent = items[i].json.text as string;
									} else {
										// If still not found, use sourceFieldName as content (might be resolved expression)
										textContent = sourceFieldName;
									}
								}
							}
						}

						if (!textContent || typeof textContent !== 'string') {
							// Skip this source field if content is not available
							continue;
						}

						// Parse the content using this source field's field mappings and add to mappedData
						for (const mapping of fieldMappings) {
							const start = mapping.startPosition;
							const end = start + mapping.length;
							let value = textContent.substring(start, end);

							if (mapping.type === 'N') {
								// Numeric field - trim for parsing
								const trimmedValue = value.trim();
								if (mapping.decimals && mapping.decimals > 0) {
									// Decimal number: split integer and decimal parts
									const integerPart =
										trimmedValue.substring(0, trimmedValue.length - mapping.decimals) || '0';
									const decimalPart =
										trimmedValue.substring(trimmedValue.length - mapping.decimals) || '0';
									mappedData[mapping.fieldName] = parseFloat(`${integerPart}.${decimalPart}`) || 0;
								} else {
									// Integer number
									mappedData[mapping.fieldName] = parseInt(trimmedValue, 10) || 0;
								}
							} else {
								// Alphanumeric field - trim right spaces only (preserve leading spaces)
								mappedData[mapping.fieldName] = value.replace(/\s+$/, '');
							}
						}
					}

					// Add single item with all parsed fields from all source fields
					returnItems.push({
						json: mappedData,
					});
				} else if (operation === 'parseTextFile') {
					if (!fileContent) {
						throw new NodeOperationError(this.getNode(), 'File content is empty');
					}
					// Get parser options
					const parserOptions = this.getNodeParameter('parserOptions', i, {}) as {
						hasHeader?: boolean;
						headerStartsWith?: string;
						hasFooter?: boolean;
						footerStartsWith?: string;
					};

					// Split content into lines, keeping empty lines
					const lines = fileContent.split(/\r?\n/);

					// First, collect all non-empty lines with their indices
					const nonEmptyLines: Array<{ index: number; line: string }> = [];
					for (let j = 0; j < lines.length; j++) {
						const line = lines[j];
						if (line.trim().length > 0) {
							nonEmptyLines.push({ index: j, line });
						}
					}

					// Find header and footer lines if they exist
					let headerLine: string | undefined;
					let footerLine: string | undefined;

					if (parserOptions.hasHeader && nonEmptyLines.length > 0) {
						const firstLine = nonEmptyLines[0].line.trim();
						const headerPrefix = (parserOptions.headerStartsWith || 'H').trim();
						if (firstLine.startsWith(headerPrefix)) {
							headerLine = nonEmptyLines[0].line;
						}
					}

					if (parserOptions.hasFooter && nonEmptyLines.length > 0) {
						const lastLine = nonEmptyLines[nonEmptyLines.length - 1].line.trim();
						const footerPrefix = (parserOptions.footerStartsWith || 'T').trim();
						if (lastLine.startsWith(footerPrefix)) {
							footerLine = nonEmptyLines[nonEmptyLines.length - 1].line;
						}
					}

					// Return each line as a separate item with just the line content
					// If hasHeader/hasFooter are enabled, skip header and footer lines as separate items
					const lineItems = [];
					for (let k = 0; k < nonEmptyLines.length; k++) {
						const { line } = nonEmptyLines[k];
						const trimmedLine = line.trim();

						// Determine line type based on user settings
						let lineType = 'line';
						let isHeader = false;
						let isFooter = false;

						// Check for header
						if (parserOptions.hasHeader && k === 0) {
							const headerPrefix = (parserOptions.headerStartsWith || 'H').trim();
							if (trimmedLine.startsWith(headerPrefix)) {
								lineType = 'header';
								isHeader = true;
							}
						}

						// Check for footer
						if (parserOptions.hasFooter && k === nonEmptyLines.length - 1) {
							const footerPrefix = (parserOptions.footerStartsWith || 'T').trim();
							if (trimmedLine.startsWith(footerPrefix)) {
								lineType = 'footer';
								isFooter = true;
							}
						}

						// Skip header and footer lines as separate items if hasHeader/hasFooter are enabled
						if ((parserOptions.hasHeader && isHeader) || (parserOptions.hasFooter && isFooter)) {
							continue;
						}

						// Build item JSON
						const itemJson: Record<string, any> = {
							type: lineType,
							line: line,
							fileName: fileName,
						};

						// Add header and footer if they exist
						if (parserOptions.hasHeader && headerLine) {
							itemJson.header = headerLine;
						}
						if (parserOptions.hasFooter && footerLine) {
							itemJson.footer = footerLine;
						}

						lineItems.push({
							json: itemJson,
						});
					}

					const executionData = this.helpers.constructExecutionMetaData(lineItems, {
						itemData: { item: i },
					});
					returnItems.push(...executionData);
				}
			} catch (error) {
				if (this.continueOnFail()) {
					returnItems.push({
						json: { error: error instanceof Error ? error.message : String(error) },
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
