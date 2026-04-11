import {
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	ICredentialTestFunctions,
	INodeCredentialTestResult,
	ICredentialsDecrypted,
	ICredentialDataDecryptedObject,
	BINARY_ENCODING,
	NodeOperationError,
} from 'n8n-workflow';
import SftpClient, { FileInfo } from 'ssh2-sftp-client';
import { Readable } from 'stream';
import { basename, dirname } from 'path';
import { createWriteStream } from 'fs';
import { file as tmpFile } from 'tmp-promise';
import type { IDataObject } from 'n8n-workflow';

function formatPrivateKey(key: string): string {
	return key.replace(/\\n/g, '\n');
}

async function recursivelyCreateSftpDirs(sftp: SftpClient, path: string) {
	const dirPath = dirname(path);
	const dirExists = await sftp.exists(dirPath);

	if (!dirExists) {
		await sftp.mkdir(dirPath, true);
	}
}

function normalizeSFtpItem(input: FileInfo, path: string, recursive = false) {
	const item = input as any;
	item.accessTime = new Date(input.accessTime);
	item.modifyTime = new Date(input.modifyTime);
	item.path = !recursive ? `${path}${path.endsWith('/') ? '' : '/'}${item.name}` : path;
}

async function callRecursiveList(
	path: string,
	client: SftpClient,
	normalizeFunction: (input: FileInfo, path: string, recursive?: boolean) => void,
) {
	const pathArray: string[] = [path];
	let currentPath = path;
	const directoryItems: FileInfo[] = [];
	let index = 0;

	const prepareAndNormalize = (item: FileInfo) => {
		if (pathArray[index].endsWith('/')) {
			currentPath = `${pathArray[index]}${item.name}`;
		} else {
			currentPath = `${pathArray[index]}/${item.name}`;
		}

		// Is directory
		if (item.type === 'd') {
			// ignore . and .. to prevent infinite loop
			if (item.name === '.' || item.name === '..') {
				return;
			}
			pathArray.push(currentPath);
		}

		normalizeFunction(item, currentPath, true);
		directoryItems.push(item);
	};

	do {
		const returnData: FileInfo[] = await client.list(pathArray[index]);
		returnData.forEach(prepareAndNormalize);
		index++;
	} while (index <= pathArray.length - 1);

	return directoryItems;
}

export class SftpNode implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'SFTP',
		name: 'sftpNode',
		icon: 'file:ftp.svg',
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["operation"]}}',
		description: 'SFTP sunucusu ile dosya işlemleri yap',
		defaults: {
			name: 'SFTP',
		},
		inputs: ['main'],
		outputs: ['main'],
		credentials: [
			{
				name: 'sftp',
				required: true,
				testedBy: 'sftpConnectionTest',
			},
		],
		properties: [
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				options: [
					{
						name: 'Create Directory',
						value: 'mkdir',
						description: 'Klasör oluştur',
						action: 'Create a directory',
					},
					{
						name: 'Delete File',
						value: 'delete',
						description: 'Dosya sil',
						action: 'Delete a file',
					},
					{
						name: 'Download File',
						value: 'download',
						description: 'Dosya indir',
						action: 'Download a file',
					},
					{
						name: 'List Files',
						value: 'list',
						description: 'Dosya listesini getir',
						action: 'List files',
					},
					{
						name: 'Move',
						value: 'rename',
						description: 'Dosya veya klasörü taşı',
						action: 'Move a file or folder',
					},
					{
						name: 'Upload File',
						value: 'upload',
						description: 'Dosya yükle',
						action: 'Upload a file',
					},
				],
				default: 'list',
			},
			{
				displayName: 'Path',
				name: 'remotePath',
				type: 'string',
				default: '/',
				placeholder: 'e.g. /public/folder',
				displayOptions: {
					show: {
						operation: ['list', 'download', 'delete', 'mkdir'],
					},
				},
				description: 'The path of directory to list contents of',
				required: true,
			},
			{
				displayName: 'Old Path',
				name: 'oldPath',
				type: 'string',
				default: '',
				displayOptions: {
					show: {
						operation: ['rename'],
					},
				},
				description: 'Eski dosya/klasör yolu',
				required: true,
			},
			{
				displayName: 'New Path',
				name: 'newPath',
				type: 'string',
				default: '',
				displayOptions: {
					show: {
						operation: ['rename'],
					},
				},
				description: 'Yeni dosya/klasör yolu',
				required: true,
			},
			{
				displayName: 'Binary Data',
				name: 'binaryData',
				type: 'boolean',
				default: true,
				displayOptions: {
					show: {
						operation: ['upload'],
					},
				},
				description: 'Whether to use binary data (true) or local path (false)',
			},
			{
				displayName: 'Input Binary Field',
				name: 'binaryPropertyName',
				type: 'string',
				default: 'data',
				displayOptions: {
					show: {
						operation: ['upload'],
						binaryData: [true],
					},
				},
				description: 'Binary data içeren input field adı',
				required: true,
			},
			{
				displayName: 'Local Path',
				name: 'localPath',
				type: 'string',
				default: '',
				displayOptions: {
					show: {
						operation: ['upload'],
						binaryData: [false],
					},
				},
				description: 'Yüklenecek dosyanın yerel yolu',
			},
			{
				displayName: 'Remote File Path',
				name: 'remoteFilePath',
				type: 'string',
				default: '',
				displayOptions: {
					show: {
						operation: ['upload'],
					},
				},
				description: 'Uzak sunucudaki hedef dosya yolu',
				required: true,
			},
			{
				displayName: 'Put Output File in Field',
				name: 'binaryPropertyNameDownload',
				type: 'string',
				default: 'data',
				displayOptions: {
					show: {
						operation: ['download'],
					},
				},
				description: 'İndirilen dosyanın binary field adı',
				required: true,
			},
			{
				displayName: 'Recursive',
				name: 'recursive',
				type: 'boolean',
				default: false,
				displayOptions: {
					show: {
						operation: ['list'],
					},
				},
				description: 'Whether to list all subdirectories',
			},
			{
				displayName: 'Options',
				name: 'options',
				type: 'collection',
				placeholder: 'Add Field',
				default: {},
				displayOptions: {
					show: {
						operation: ['download'],
					},
				},
				options: [
					{
						displayName: 'Enable Concurrent Reads',
						name: 'enableConcurrentReads',
						type: 'boolean',
						default: false,
						description:
							'Whether to enable concurrent reads for faster download of large files. When enabled, the file is downloaded in parallel chunks.',
					},
					{
						displayName: 'Max Concurrent Reads',
						name: 'maxConcurrentReads',
						type: 'number',
						default: 5,
						description:
							'Maximum number of parallel connections to use when downloading (only when concurrent reads is enabled)',
						displayOptions: {
							show: {
								enableConcurrentReads: [true],
							},
						},
					},
					{
						displayName: 'Chunk Size',
						name: 'chunkSize',
						type: 'number',
						default: 64,
						description:
							'Size of each chunk in KB to download in parallel (only when concurrent reads is enabled)',
						displayOptions: {
							show: {
								enableConcurrentReads: [true],
							},
						},
					},
				],
			},
			{
				displayName: 'Options',
				name: 'options',
				type: 'collection',
				placeholder: 'Add Field',
				default: {},
				displayOptions: {
					show: {
						operation: ['delete'],
					},
				},
				options: [
					{
						displayName: 'Folder',
						name: 'folder',
						type: 'boolean',
						default: false,
						description: 'Whether to delete a folder',
					},
					{
						displayName: 'Recursive',
						name: 'recursive',
						type: 'boolean',
						default: false,
						displayOptions: {
							show: {
								folder: [true],
							},
						},
						description: 'Whether to delete all subdirectories',
					},
				],
			},
			{
				displayName: 'Options',
				name: 'options',
				type: 'collection',
				placeholder: 'Add Field',
				default: {},
				displayOptions: {
					show: {
						operation: ['rename'],
					},
				},
				options: [
					{
						displayName: 'Create Directories',
						name: 'createDirectories',
						type: 'boolean',
						default: false,
						description: "Whether to create directories if they don't exist",
					},
				],
			},
			{
				displayName: 'Additional Fields',
				name: 'additionalFields',
				type: 'collection',
				placeholder: 'Add Field',
				default: {},
				displayOptions: {
					show: {
						operation: ['download', 'upload'],
					},
				},
				options: [
					{
						displayName: 'Name',
						name: 'name',
						type: 'string',
						default: '',
						description:
							'Custom file name. For download: overrides the filename from the remote path. The downloaded file will have this name in the output. For upload: not currently used.',
					},
				],
			},
		],
	};

	methods = {
		credentialTest: {
			async sftpConnectionTest(
				this: ICredentialTestFunctions,
				credential: ICredentialsDecrypted,
			): Promise<INodeCredentialTestResult> {
				const credentials = credential.data as ICredentialDataDecryptedObject;
				const sftp = new SftpClient();
				try {
					if (credentials.privateKey) {
						await sftp.connect({
							host: credentials.host as string,
							port: credentials.port as number,
							username: credentials.username as string,
							password: (credentials.password as string) || undefined,
							privateKey: formatPrivateKey(credentials.privateKey as string),
							passphrase: credentials.passphrase as string | undefined,
						});
					} else {
						await sftp.connect({
							host: credentials.host as string,
							port: credentials.port as number,
							username: credentials.username as string,
							password: credentials.password as string,
						});
					}
					await sftp.end();
					return {
						status: 'OK',
						message: 'Bağlantı başarılı!',
					};
				} catch (error) {
					await sftp.end();
					return {
						status: 'Error',
						message: error instanceof Error ? error.message : String(error),
					};
				}
			},
		},
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		let returnItems: INodeExecutionData[] = [];
		const operation = this.getNodeParameter('operation', 0) as string;

		const credentials = await this.getCredentials<ICredentialDataDecryptedObject>('sftp');
		const sftp = new SftpClient();

		try {
			if (credentials.privateKey) {
				await sftp.connect({
					host: credentials.host as string,
					port: credentials.port as number,
					username: credentials.username as string,
					password: (credentials.password as string) || undefined,
					privateKey: formatPrivateKey(credentials.privateKey as string),
					passphrase: credentials.passphrase as string | undefined,
					readyTimeout: 10000,
					algorithms: {
						compress: ['zlib@openssh.com', 'zlib', 'none'],
					},
				});
			} else {
				await sftp.connect({
					host: credentials.host as string,
					port: credentials.port as number,
					username: credentials.username as string,
					password: credentials.password as string,
					readyTimeout: 10000,
					algorithms: {
						compress: ['zlib@openssh.com', 'zlib', 'none'],
					},
				});
			}

			for (let i = 0; i < items.length; i++) {
				try {
					const newItem: INodeExecutionData = {
						json: items[i].json,
						binary: {},
						pairedItem: items[i].pairedItem,
					};

					if (items[i].binary !== undefined && newItem.binary) {
						Object.assign(newItem.binary, items[i].binary);
					}

					items[i] = newItem;

					if (operation === 'list') {
						// Use path from first item only, or use the parameter directly
						let path = this.getNodeParameter('remotePath', 0) as string;
						if (!path || path === '') {
							path = '/';
						}
						// Normalize path - ensure it doesn't have trailing slash unless it's root
						path = path.trim();
						if (path !== '/' && path.endsWith('/')) {
							path = path.slice(0, -1);
						}

						const recursive = this.getNodeParameter('recursive', 0, false) as boolean;

						// Check if path is a file or directory
						const pathExists = await sftp.exists(path);
						if (pathExists === false) {
							throw new NodeOperationError(this.getNode(), `Path "${path}" does not exist`);
						}

						let responseData: FileInfo[];
						if (pathExists === 'd') {
							// It's a directory, list it
							if (recursive) {
								responseData = await callRecursiveList(path, sftp, normalizeSFtpItem);
							} else {
								responseData = await sftp.list(path);
								// Filter out . and .. directories
								responseData = responseData.filter(
									(item) => item.name !== '.' && item.name !== '..',
								);
								responseData.forEach((item) => normalizeSFtpItem(item, path));
							}
						} else {
							// It's a file, return file info only
							const fileInfo = await sftp.stat(path);
							normalizeSFtpItem(fileInfo as unknown as FileInfo, path);
							responseData = [fileInfo as unknown as FileInfo];
						}

						// Return all items from the single path, mapped to all input items
						const executionData = this.helpers.constructExecutionMetaData(
							this.helpers.returnJsonArray(responseData as unknown as IDataObject[]),
							{ itemData: { item: 0 } },
						);
						returnItems = returnItems.concat(executionData);
						// Break after first list - only list once
						break;
					}

					if (operation === 'delete') {
						const path = this.getNodeParameter('remotePath', i) as string;
						const options = this.getNodeParameter('options', i, {}) as {
							folder?: boolean;
							recursive?: boolean;
						};

						if (options.folder === true) {
							await sftp.rmdir(path, !!options.recursive);
						} else {
							await sftp.delete(path);
						}
						const executionData = this.helpers.constructExecutionMetaData(
							[{ json: { success: true } }],
							{ itemData: { item: i } },
						);
						returnItems = returnItems.concat(executionData);
					}

					if (operation === 'rename') {
						const oldPath = this.getNodeParameter('oldPath', i) as string;
						const { createDirectories = false } = this.getNodeParameter('options', i, {}) as {
							createDirectories: boolean;
						};
						const newPath = this.getNodeParameter('newPath', i) as string;

						if (createDirectories) {
							await recursivelyCreateSftpDirs(sftp, newPath);
						}

						await sftp.rename(oldPath, newPath);
						const executionData = this.helpers.constructExecutionMetaData(
							[{ json: { success: true } }],
							{ itemData: { item: i } },
						);
						returnItems = returnItems.concat(executionData);
					}

					if (operation === 'download') {
						let path = this.getNodeParameter('remotePath', i) as string;
						if (!path || path === '') {
							throw new NodeOperationError(
								this.getNode(),
								'Remote path is required for download operation',
							);
						}
						// Normalize path - remove any special characters that might cause issues
						path = path.trim().replace(/^~/, '');

						// Check if path exists
						const pathExists = await sftp.exists(path);
						if (pathExists === false) {
							throw new NodeOperationError(this.getNode(), `File "${path}" does not exist`);
						}

						// Check if it's a file, not a directory
						if (pathExists === 'd') {
							throw new NodeOperationError(
								this.getNode(),
								`Path "${path}" is a directory, not a file. Use "List Files" operation for directories.`,
							);
						}

						const options = this.getNodeParameter('options', i, {}) as {
							enableConcurrentReads?: boolean;
							maxConcurrentReads?: number;
							chunkSize?: number;
						};
						const binaryFile = await tmpFile({ prefix: 'n8n-sftp-', keep: false });
						try {
							if (!options.enableConcurrentReads) {
								await sftp.get(path, createWriteStream(binaryFile.path));
							} else {
								await sftp.fastGet(path, binaryFile.path, {
									concurrency:
										options.maxConcurrentReads === undefined
											? 5
											: Number(options.maxConcurrentReads),
									chunkSize:
										(options.chunkSize === undefined ? 64 : Number(options.chunkSize)) * 1024,
								});
							}

							const dataPropertyNameDownload = this.getNodeParameter(
								'binaryPropertyNameDownload',
								i,
							);

							// Get filename from path, preserving UTF-8 encoding
							let fileName = basename(path);
							// If additionalFields.name is provided, use it
							const additionalFields = this.getNodeParameter('additionalFields', i, {}) as {
								name?: string;
							};
							if (additionalFields.name) {
								fileName = additionalFields.name;
							}

							items[i].binary![dataPropertyNameDownload as string] =
								await this.nodeHelpers.copyBinaryFile(binaryFile.path, fileName);

							const executionData = this.helpers.constructExecutionMetaData(
								this.helpers.returnJsonArray(items[i]),
								{ itemData: { item: i } },
							);
							returnItems = returnItems.concat(executionData);
						} finally {
							await binaryFile.cleanup();
						}
					}

					if (operation === 'upload') {
						const remotePath = this.getNodeParameter('remoteFilePath', i) as string;
						await recursivelyCreateSftpDirs(sftp, remotePath);

						if (this.getNodeParameter('binaryData', i, true)) {
							const binaryPropertyName = this.getNodeParameter('binaryPropertyName', i);
							const binaryData = this.helpers.assertBinaryData(i, binaryPropertyName);

							let uploadData: Buffer | Readable;
							if (binaryData.id) {
								uploadData = await this.helpers.getBinaryStream(binaryData.id);
							} else {
								uploadData = Buffer.from(binaryData.data, BINARY_ENCODING);
							}
							await sftp.put(uploadData, remotePath);
						} else {
							const localPath = this.getNodeParameter('localPath', i) as string;
							await sftp.put(localPath, remotePath);
						}

						const executionData = this.helpers.constructExecutionMetaData(
							this.helpers.returnJsonArray(items[i]),
							{ itemData: { item: i } },
						);
						returnItems = returnItems.concat(executionData);
					}

					if (operation === 'mkdir') {
						const remotePath = this.getNodeParameter('remotePath', i) as string;
						await sftp.mkdir(remotePath, true);
						const executionData = this.helpers.constructExecutionMetaData(
							[{ json: { success: true, createdPath: remotePath } }],
							{ itemData: { item: i } },
						);
						returnItems = returnItems.concat(executionData);
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

			await sftp.end();
		} catch (error) {
			await sftp.end();
			throw error;
		}

		return [returnItems];
	}
}
