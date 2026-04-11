import type {
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	INode,
	IDataObject,
} from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';
import { execFile } from 'child_process';
import type { ExecFileOptions } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

interface ParsedParameter {
	name: string;
	type: string;
	required: boolean;
	enumValues?: string[];
}

interface WorkflowNode {
	type?: string;
	notes?: string;
	parameters?: {
		workflowInputs?: {
			values?: Array<{
				name: string;
				type?: string;
			}>;
		};
	};
}

interface Workflow {
	name: string;
	nodes?: WorkflowNode[];
}

interface ProxyGenerationOptions {
	serviceUrl: string;
	outputFile: string;
	namespace: string;
	language?: string;
	serializer?: string;
	collectionType?: string;
	enableDataBinding?: boolean;
	asyncMethods?: boolean;
	internalTypes?: boolean;
	noConfig?: boolean;
	generateConfig?: boolean;
	configOutputPath?: string;
	mergeWithExistingConfig?: boolean;
	maxReceivedMessageSize?: number;
	operationTimeout?: number;
	useMex?: boolean;
	useWsdl?: boolean;
	reuseTypes?: string[];
	referenceAssemblies?: string[];
	referencePaths?: string[];
	messageContract?: boolean;
	dataContractOnly?: boolean;
	serviceContractOnly?: boolean;
	excludeTypes?: string[];
	importXmlTypes?: boolean;
	importWsdlTypes?: boolean;
	useDefaultCredentials?: boolean;
	username?: string;
	password?: string;
	clientCertificate?: string;
	ignoreCertificateErrors?: boolean;
	verbose?: boolean;
	quietMode?: boolean;
	logFile?: string;
	includeStackTrace?: boolean;
	tempDir?: string;
	svcutilPath?: string;
	dotnetVersion?: string;
	cleanupTempFiles?: boolean;
}

const mapTypeToXsd = (type: string): string => {
	const typeMap: Record<string, string> = {
		string: 'xs:string',
		number: 'xs:decimal',
		decimal: 'xs:decimal',
		dateTime: 'xs:string',
		any: 'xs:string',
		enum: 'xs:string',
	};

	return typeMap[type.toLowerCase()] || 'xs:string';
};

const toStringArray = (value: string | undefined): string[] => {
	if (!value) return [];
	return value
		.split(',')
		.map((entry) => entry.trim())
		.filter((entry) => entry.length > 0);
};

const normalizeStringArray = (value: unknown): string[] => {
	if (Array.isArray(value)) {
		return (value as string[]).map((entry) => entry.trim()).filter((entry) => entry.length > 0);
	}
	if (typeof value === 'string') {
		return toStringArray(value);
	}
	return [];
};

const toBoolean = (value: unknown, defaultValue = false): boolean =>
	typeof value === 'boolean' ? value : defaultValue;

const toNumber = (value: unknown, defaultValue?: number): number | undefined => {
	if (value === undefined || value === null || value === '') {
		return defaultValue;
	}
	const num = Number(value);
	return Number.isNaN(num) ? defaultValue : num;
};

const parseNotes = (notes: string): ParsedParameter[] => {
	if (!notes) return [];

	const lines = notes.split('\n');
	const parameters: ParsedParameter[] = [];

	for (const line of lines) {
		const trimmed = line.trim();
		if (!trimmed.startsWith('@')) continue;

		const match = trimmed.match(/@\s*(\w+)\s+(\w+)\s+(required|optional)(?:\s+\(([^)]+)\))?/);
		if (!match) continue;

		const [, name, type, requiredStr, enumValuesStr] = match;
		const required = requiredStr === 'required';
		const enumValues = enumValuesStr ? enumValuesStr.split('-').map((v) => v.trim()) : undefined;

		parameters.push({
			name: name.trim(),
			type: mapTypeToXsd(type.trim()),
			required,
			enumValues,
		});
	}

	return parameters;
};

const extractParameters = (node: WorkflowNode): ParsedParameter[] => {
	const noteParameters = node.notes ? parseNotes(node.notes) : [];
	if (noteParameters.length > 0) {
		return noteParameters;
	}

	const workflowInputs = node.parameters?.workflowInputs?.values ?? [];
	return workflowInputs
		.map((input) => {
			const name = input.name?.trim();
			if (!name) return null;
			const type = mapTypeToXsd((input.type ?? 'string').trim());
			return {
				name,
				type,
				required: false,
			};
		})
		.filter((param): param is ParsedParameter => param !== null);
};

const isWorkflowLike = (candidate: unknown): candidate is Workflow => {
	if (candidate === null || typeof candidate !== 'object') {
		return false;
	}
	return Array.isArray((candidate as Workflow).nodes);
};

const extractArrayFromObject = (input: IDataObject): Workflow[] | null => {
	const arrayCandidates = ['workflowList', 'data', 'value', 'items'];
	for (const key of arrayCandidates) {
		const value = input[key];
		if (Array.isArray(value)) {
			return value as Workflow[];
		}
	}

	if (isWorkflowLike(input)) {
		return [input as Workflow];
	}

	return null;
};

const normalizeWorkflowList = (input: unknown, node: INode): Workflow[] => {
	if (Array.isArray(input)) {
		return input as Workflow[];
	}

	if (typeof input === 'string') {
		try {
			const parsed = JSON.parse(input);
			if (Array.isArray(parsed)) {
				return parsed as Workflow[];
			}
			if (typeof parsed === 'object' && parsed !== null) {
				const extracted = extractArrayFromObject(parsed as IDataObject);
				if (extracted) {
					return extracted;
				}
			}
			throw new NodeOperationError(node, 'Workflow listesi bir dizi olmalıdır.');
		} catch (error) {
			throw new NodeOperationError(node, `Geçersiz JSON formatı: ${error}`);
		}
	}

	if (typeof input === 'object' && input !== null) {
		const extracted = extractArrayFromObject(input as IDataObject);
		if (extracted) {
			return extracted;
		}
	}

	throw new NodeOperationError(node, 'Workflow listesi geçersiz formatta.');
};

// @ts-expect-error - Custom fonksiyon, gelecekte kullanılacak
const _normalizeProxyOptions = (input: IDataObject, node: INode): ProxyGenerationOptions => {
	const serviceUrl = (input.serviceUrl as string)?.trim();
	if (!serviceUrl) {
		throw new NodeOperationError(node, 'serviceUrl parametresi zorunludur.');
	}

	const outputFile = (input.outputFile as string)?.trim() || 'GeneratedProxy.cs';
	const namespace = (input.namespace as string)?.trim() || 'Generated.Proxy';
	const language = (input.language as string)?.trim() || 'cs';
	const serializer = (input.serializer as string)?.trim() || 'DataContractSerializer';
	const collectionType = (input.collectionType as string)?.trim() || 'List';
	const generateConfig = toBoolean(input.generateConfig, true);
	const noConfig = toBoolean(input.noConfig) || !generateConfig;
	const configOutputPath =
		(input.configOutputPath as string)?.trim() || `${outputFile.replace(/\.cs$/i, '')}.config`;

	return {
		serviceUrl,
		outputFile,
		namespace,
		language,
		serializer,
		collectionType,
		enableDataBinding: toBoolean(input.enableDataBinding),
		asyncMethods: toBoolean(input.asyncMethods, true),
		internalTypes: toBoolean(input.internalTypes),
		noConfig,
		generateConfig,
		configOutputPath,
		mergeWithExistingConfig: toBoolean(input.mergeWithExistingConfig),
		maxReceivedMessageSize: toNumber(input.maxReceivedMessageSize, 65536000),
		operationTimeout: toNumber(input.operationTimeout, 60),
		useMex: toBoolean(input.useMex),
		useWsdl: toBoolean(input.useWsdl, true),
		reuseTypes: normalizeStringArray(input.reuseTypes),
		referenceAssemblies: normalizeStringArray(input.referenceAssemblies),
		referencePaths: normalizeStringArray(input.referencePaths),
		messageContract: toBoolean(input.messageContract),
		dataContractOnly: toBoolean(input.dataContractOnly),
		serviceContractOnly: toBoolean(input.serviceContractOnly),
		excludeTypes: normalizeStringArray(input.excludeTypes),
		importXmlTypes: toBoolean(input.importXmlTypes, true),
		importWsdlTypes: toBoolean(input.importWsdlTypes, true),
		useDefaultCredentials: toBoolean(input.useDefaultCredentials),
		username: (input.username as string)?.trim() ?? '',
		password: (input.password as string)?.toString() ?? '',
		clientCertificate: (input.clientCertificate as string)?.trim() ?? '',
		ignoreCertificateErrors: toBoolean(input.ignoreCertificateErrors),
		verbose: toBoolean(input.verbose),
		quietMode: toBoolean(input.quietMode),
		logFile: (input.logFile as string)?.trim() ?? '',
		includeStackTrace: toBoolean(input.includeStackTrace),
		tempDir: (input.tempDir as string)?.trim() ?? '',
		svcutilPath: (input.svcutilPath as string)?.trim() ?? '',
		dotnetVersion: (input.dotnetVersion as string)?.trim() || 'net8.0',
		cleanupTempFiles: toBoolean(input.cleanupTempFiles, true),
	};
};

const pushFlag = (args: string[], condition: boolean | undefined, flag: string) => {
	if (condition) {
		args.push(flag);
	}
};

const buildSvcutilArguments = (options: ProxyGenerationOptions): string[] => {
	const args: string[] = [];
	args.push(`/out:${options.outputFile}`);
	if (options.namespace) {
		args.push(`/n:*,${options.namespace}`);
	}
	if (options.language && options.language !== 'cs') {
		args.push(`/language:${options.language}`);
	}
	if (options.serializer) {
		args.push(`/serializer:${options.serializer}`);
	}
	if (options.collectionType) {
		args.push(`/collectionType:${options.collectionType}`);
	}
	pushFlag(args, options.enableDataBinding, '/enableDataBinding');
	pushFlag(args, options.asyncMethods, '/async');
	pushFlag(args, options.internalTypes, '/internal');

	if (options.generateConfig && !options.noConfig) {
		args.push(`/config:${options.configOutputPath || `${options.outputFile}.config`}`);
	} else if (options.noConfig) {
		args.push('/noConfig');
	}

	pushFlag(args, options.mergeWithExistingConfig, '/mergeConfig');
	if (options.maxReceivedMessageSize !== undefined) {
		args.push(`/maxReceivedMessageSize:${options.maxReceivedMessageSize}`);
	}
	if (options.operationTimeout !== undefined) {
		args.push(`/operationTimeout:${options.operationTimeout}`);
	}
	pushFlag(args, options.useMex, '/mex');
	pushFlag(args, options.useWsdl, '/wsdl');

	options.reuseTypes?.forEach((entry) => args.push(`/rty:${entry}`));
	options.referenceAssemblies?.forEach((entry) => args.push(`/reference:${entry}`));
	options.referencePaths?.forEach((entry) => args.push(`/referencePath:${entry}`));

	pushFlag(args, options.messageContract, '/messageContract');
	pushFlag(args, options.dataContractOnly, '/dataContractOnly');
	pushFlag(args, options.serviceContractOnly, '/serviceContractOnly');
	options.excludeTypes?.forEach((entry) => args.push(`/excludeType:${entry}`));

	if (options.importXmlTypes === false) {
		args.push('/noImportXmlTypes');
	}
	if (options.importWsdlTypes === false) {
		args.push('/noImportWsdlTypes');
	}

	pushFlag(args, options.useDefaultCredentials, '/userDefaultCredentials');
	if (options.username) {
		args.push(`/username:${options.username}`);
	}
	if (options.password) {
		args.push(`/password:${options.password}`);
	}
	if (options.clientCertificate) {
		args.push(`/clientCertificate:${options.clientCertificate}`);
	}

	pushFlag(args, options.verbose, '/verbose');
	pushFlag(args, options.quietMode, '/quiet');
	if (options.logFile) {
		args.push(`/log:${options.logFile}`);
	}
	pushFlag(args, options.includeStackTrace, '/includeStackTrace');

	if (options.dotnetVersion) {
		args.push(`/targetFramework:${options.dotnetVersion}`);
	}

	args.push(options.serviceUrl);
	return args;
};

const buildCommandString = (cmd: string, args: string[]): string =>
	[cmd, ...args.map((arg) => (/\s/.test(arg) ? `"${arg}"` : arg))].join(' ');

// @ts-expect-error - Custom fonksiyon, gelecekte kullanılacak
const _runSvcutil = async (options: ProxyGenerationOptions, node: INode) => {
	const svcutilPath =
		options.svcutilPath && options.svcutilPath.length > 0 ? options.svcutilPath : 'svcutil';
	const args = buildSvcutilArguments(options);
	const execOptions: ExecFileOptions = {};

	if (options.tempDir) {
		execOptions.cwd = options.tempDir;
	}

	execOptions.env = { ...process.env };

	if (options.ignoreCertificateErrors) {
		execOptions.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
	}
	if (options.includeStackTrace) {
		execOptions.env.SVCUTIL_INCLUDE_STACKTRACE = '1';
	}

	try {
		const { stdout, stderr } = await execFileAsync(svcutilPath, args, execOptions);
		return {
			stdout: stdout?.toString() ?? '',
			stderr: stderr?.toString() ?? '',
			command: buildCommandString(svcutilPath, args),
		};
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Bilinmeyen hata';
		throw new NodeOperationError(node, `svcutil çalıştırılırken hata oluştu: ${message}`);
	}
};

const generateWsdl = (
	workflows: Workflow[],
	serviceNamespace: string,
	dataContractNamespace: string,
	serviceName: string,
	portTypeName: string,
	includeSoap11Binding: boolean,
	includeSoap12Binding: boolean,
	soap11PortLocation: string,
	soap12PortLocation: string,
	useWrapperElement: boolean,
): string => {
	const operations: string[] = [];
	const types: string[] = [];
	const messages: string[] = [];
	const portTypeOperations: string[] = [];
	const bindingOperations11: string[] = [];
	const bindingOperations12: string[] = [];

	const enumTypes = new Map<string, string[]>();
	const serviceNamespaceEnumTypes: string[] = [];

	for (const workflow of workflows) {
		if (!workflow.nodes || workflow.nodes.length === 0) continue;

		const triggerNode = workflow.nodes.find(
			(node) => node.type === 'n8n-nodes-base.executeWorkflowTrigger',
		);
		if (!triggerNode) continue;

		const parameters = extractParameters(triggerNode);
		for (const param of parameters) {
			if (param.enumValues && param.enumValues.length > 0) {
				const enumName = capitalizeFirst(param.name);
				if (!enumTypes.has(enumName)) {
					enumTypes.set(enumName, param.enumValues);
				}
			}
		}
	}

	for (const [enumName, enumValues] of enumTypes.entries()) {
		const enumRestrictions = enumValues.map((val) => `<xs:enumeration value="${val}"/>`).join('');

		types.push(
			`<xs:simpleType name="${enumName}"><xs:restriction base="xs:string">${enumRestrictions}</xs:restriction></xs:simpleType><xs:element name="${enumName}" nillable="true" type="tns:${enumName}"/>`,
		);

		if (useWrapperElement) {
			serviceNamespaceEnumTypes.push(
				`<xs:simpleType name="${enumName}"><xs:restriction base="xs:string">${enumRestrictions}</xs:restriction></xs:simpleType>`,
			);
		}
	}

	for (const workflow of workflows) {
		if (!workflow.nodes || workflow.nodes.length === 0) continue;

		const triggerNode = workflow.nodes.find(
			(node) => node.type === 'n8n-nodes-base.executeWorkflowTrigger',
		);
		if (!triggerNode) continue;

		const parameters = extractParameters(triggerNode);
		if (parameters.length === 0) continue;

		const operationName = capitalizeFirst(workflow.name);
		const requestTypeName = `${operationName}Request`;
		const responseTypeName = `${operationName}Response`;
		const responseWrapperTypeName = `DbsResponseOf${operationName}bfzVA3Hm`;

		const schemaPrefix = 'sch';
		const requestElementsForDataContract = parameters
			.map((param) => {
				const type = param.enumValues
					? `${schemaPrefix}:${capitalizeFirst(param.name)}`
					: param.type;
				const minOccurs = param.required ? '1' : '0';
				const nillable = param.required ? 'false' : 'true';
				return `<xs:element minOccurs="${minOccurs}" name="${param.name}" nillable="${nillable}" type="${type}"/>`;
			})
			.join('');

		types.push(
			`<xs:complexType name="${requestTypeName}"><xs:sequence xmlns:${schemaPrefix}="${dataContractNamespace}">${requestElementsForDataContract}</xs:sequence></xs:complexType><xs:element name="${requestTypeName}" nillable="true" type="tns:${requestTypeName}"/>`,
		);

		types.push(
			`<xs:complexType name="${responseWrapperTypeName}"><xs:sequence><xs:element minOccurs="0" name="ResponseCode" nillable="true" type="xs:string"/><xs:element minOccurs="0" name="ResponseMessage" nillable="true" type="xs:string"/><xs:element minOccurs="0" name="Value" nillable="true" type="xs:string"/></xs:sequence></xs:complexType><xs:element name="${responseWrapperTypeName}" nillable="true" type="tns:${responseWrapperTypeName}"/>`,
		);

		const requestElementsWithPrefix = parameters
			.map((param) => {
				const type = param.enumValues
					? `${schemaPrefix}:${capitalizeFirst(param.name)}`
					: param.type;
				const minOccurs = param.required ? '1' : '0';
				const nillable = param.required ? 'false' : 'true';
				return `<xs:element minOccurs="${minOccurs}" name="${param.name}" nillable="${nillable}" type="${type}"/>`;
			})
			.join('');

		let operationElement: string;
		if (useWrapperElement) {
			operationElement = `<xs:element name="${operationName}" xmlns:${schemaPrefix}="${dataContractNamespace}"><xs:complexType><xs:sequence><xs:element minOccurs="0" name="request" nillable="true" type="${schemaPrefix}:${requestTypeName}"/></xs:sequence></xs:complexType></xs:element>`;
		} else {
			operationElement = `<xs:element name="${operationName}"><xs:complexType><xs:sequence xmlns:${schemaPrefix}="${dataContractNamespace}">${requestElementsWithPrefix}</xs:sequence></xs:complexType></xs:element>`;
		}

		operations.push(
			`${operationElement}<xs:element name="${responseTypeName}"><xs:complexType><xs:sequence><xs:element minOccurs="0" name="${operationName}Result" nillable="true" type="${schemaPrefix}:${responseWrapperTypeName}" xmlns:${schemaPrefix}="${dataContractNamespace}"/></xs:sequence></xs:complexType></xs:element>`,
		);

		messages.push(
			`<wsdl:message name="I${serviceName}_${operationName}_InputMessage"><wsdl:part name="parameters" element="tns:${operationName}"/></wsdl:message><wsdl:message name="I${serviceName}_${operationName}_OutputMessage"><wsdl:part name="parameters" element="tns:${responseTypeName}"/></wsdl:message>`,
		);

		portTypeOperations.push(
			`<wsdl:operation name="${operationName}"><wsdl:input wsaw:Action="${serviceNamespace}I${serviceName}/${operationName}" message="tns:I${serviceName}_${operationName}_InputMessage"/><wsdl:output wsaw:Action="${serviceNamespace}I${serviceName}/${operationName}Response" message="tns:I${serviceName}_${operationName}_OutputMessage"/></wsdl:operation>`,
		);

		bindingOperations11.push(
			`<wsdl:operation name="${operationName}"><soap:operation soapAction="${serviceNamespace}I${serviceName}/${operationName}" style="document"/><wsdl:input><soap:body use="literal"/></wsdl:input><wsdl:output><soap:body use="literal"/></wsdl:output></wsdl:operation>`,
		);

		bindingOperations12.push(
			`<wsdl:operation name="${operationName}"><soap12:operation soapAction="${serviceNamespace}I${serviceName}/${operationName}" style="document"/><wsdl:input><soap12:body use="literal"/></wsdl:input><wsdl:output><soap12:body use="literal"/></wsdl:output></wsdl:operation>`,
		);
	}

	const serializationTypes = `<xs:schema attributeFormDefault="qualified" elementFormDefault="qualified" targetNamespace="http://schemas.microsoft.com/2003/10/Serialization/" xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:tns="http://schemas.microsoft.com/2003/10/Serialization/"><xs:element name="anyType" nillable="true" type="xs:anyType"/><xs:element name="anyURI" nillable="true" type="xs:anyURI"/><xs:element name="base64Binary" nillable="true" type="xs:base64Binary"/><xs:element name="boolean" nillable="true" type="xs:boolean"/><xs:element name="byte" nillable="true" type="xs:byte"/><xs:element name="dateTime" nillable="true" type="xs:dateTime"/><xs:element name="decimal" nillable="true" type="xs:decimal"/><xs:element name="double" nillable="true" type="xs:double"/><xs:element name="float" nillable="true" type="xs:float"/><xs:element name="int" nillable="true" type="xs:int"/><xs:element name="long" nillable="true" type="xs:long"/><xs:element name="QName" nillable="true" type="xs:QName"/><xs:element name="short" nillable="true" type="xs:short"/><xs:element name="string" nillable="true" type="xs:string"/><xs:element name="unsignedByte" nillable="true" type="xs:unsignedByte"/><xs:element name="unsignedInt" nillable="true" type="xs:unsignedInt"/><xs:element name="unsignedLong" nillable="true" type="xs:unsignedLong"/><xs:element name="unsignedShort" nillable="true" type="xs:unsignedShort"/><xs:element name="char" nillable="true" type="tns:char"/><xs:simpleType name="char"><xs:restriction base="xs:int"/></xs:simpleType><xs:element name="duration" nillable="true" type="tns:duration"/><xs:simpleType name="duration"><xs:restriction base="xs:duration"><xs:pattern value="\\-?P(\\d*D)?(T(\\d*H)?(\\d*M)?(\\d*(\\.\\d*)?S)?)?"/><xs:minInclusive value="-P10675199DT2H48M5.4775808S"/><xs:maxInclusive value="P10675199DT2H48M5.4775807S"/></xs:restriction></xs:simpleType><xs:element name="guid" nillable="true" type="tns:guid"/><xs:simpleType name="guid"><xs:restriction base="xs:string"><xs:pattern value="[\\da-fA-F]{8}-[\\da-fA-F]{4}-[\\da-fA-F]{4}-[\\da-fA-F]{4}-[\\da-fA-F]{12}"/></xs:restriction></xs:simpleType><xs:attribute name="FactoryType" type="xs:QName"/><xs:attribute name="Id" type="xs:ID"/><xs:attribute name="Ref" type="xs:IDREF"/></xs:schema>`;

	const soap11Location =
		soap11PortLocation && soap11PortLocation.length > 0
			? soap11PortLocation
			: `http://localhost/${serviceName}.svc/Basic`;

	const soap12Location =
		soap12PortLocation && soap12PortLocation.length > 0
			? soap12PortLocation
			: `http://localhost/${serviceName}.svc/Basic12`;

	const bindings: string[] = [];
	const ports: string[] = [];

	if (includeSoap11Binding) {
		bindings.push(
			`<wsdl:binding name="BasicHttpBinding_${portTypeName}" type="tns:${portTypeName}"><soap:binding transport="http://schemas.xmlsoap.org/soap/http"/>${bindingOperations11.join(
				'',
			)}</wsdl:binding>`,
		);
		ports.push(
			`<wsdl:port name="BasicHttpBinding_${portTypeName}" binding="tns:BasicHttpBinding_${portTypeName}"><soap:address location="${soap11Location}"/></wsdl:port>`,
		);
	}

	if (includeSoap12Binding) {
		bindings.push(
			`<wsdl:binding name="BasicHttpBinding_${portTypeName}_Soap12" type="tns:${portTypeName}"><soap12:binding transport="http://schemas.xmlsoap.org/soap/http"/>${bindingOperations12.join(
				'',
			)}</wsdl:binding>`,
		);
		ports.push(
			`<wsdl:port name="BasicHttpBinding_${portTypeName}_Soap12" binding="tns:BasicHttpBinding_${portTypeName}_Soap12"><soap12:address location="${soap12Location}"/></wsdl:port>`,
		);
	}

	return `<?xml version="1.0" encoding="utf-8"?><wsdl:definitions name="${serviceName}" targetNamespace="${serviceNamespace}" xmlns:wsdl="http://schemas.xmlsoap.org/wsdl/" xmlns:wsam="http://www.w3.org/2007/05/addressing/metadata" xmlns:wsx="http://schemas.xmlsoap.org/ws/2004/09/mex" xmlns:wsap="http://schemas.xmlsoap.org/ws/2004/08/addressing/policy" xmlns:msc="http://schemas.microsoft.com/ws/2005/12/wsdl/contract" xmlns:wsp="http://schemas.xmlsoap.org/ws/2004/09/policy" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap="http://schemas.xmlsoap.org/wsdl/soap/" xmlns:wsu="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd" xmlns:soap12="http://schemas.xmlsoap.org/wsdl/soap12/" xmlns:soapenc="http://schemas.xmlsoap.org/soap/encoding/" xmlns:tns="${serviceNamespace}" xmlns:tem="${serviceNamespace}" xmlns:sch="${dataContractNamespace}" xmlns:wsa10="http://www.w3.org/2005/08/addressing" xmlns:wsaw="http://www.w3.org/2006/05/addressing/wsdl" xmlns:wsa="http://schemas.xmlsoap.org/ws/2004/08/addressing"><wsdl:types><xs:schema elementFormDefault="qualified" targetNamespace="${serviceNamespace}" xmlns:xs="http://www.w3.org/2001/XMLSchema"><xs:import namespace="${dataContractNamespace}"/>${serviceNamespaceEnumTypes.join('')}${operations.join('')}</xs:schema>${serializationTypes}<xs:schema elementFormDefault="qualified" targetNamespace="${dataContractNamespace}" xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:tns="${dataContractNamespace}"><xs:import namespace="http://schemas.microsoft.com/2003/10/Serialization"/>${types.join(
		'',
	)}</xs:schema></wsdl:types>${messages.join(
		'',
	)}<wsdl:portType name="${portTypeName}">${portTypeOperations.join(
		'',
	)}</wsdl:portType>${bindings.join('')}<wsdl:service name="${serviceName}">${ports.join(
		'',
	)}</wsdl:service></wsdl:definitions>`;
};

const capitalizeFirst = (str: string): string =>
	str.charAt(0).toUpperCase() + str.slice(1).replace(/\s+/g, '');

export class UAdvancedWsdlCreator implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'U_Advanced_WSDL_Creator',
		name: 'uAdvancedWsdlCreator',
		icon: 'fa:file-code',
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["operation"]}}',
		description: 'N8N workflow listesinden WSDL ve proxy class oluşturur',
		defaults: {
			name: 'U_Advanced_WSDL_Creator',
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
						name: 'Generate WSDL',
						value: 'generateWsdl',
					},
				],
				default: 'generateWsdl',
			},
			{
				displayName: 'Workflow List (JSON)',
				name: 'workflowList',
				type: 'json',
				default: '[]',
				description: 'N8N workflow listesi JSON formatında',
				required: true,
			},
			{
				displayName: 'Use Wrapper Element',
				name: 'useWrapperElement',
				type: 'boolean',
				default: true,
				description: 'Whether a wrapper element (tem.request) should be used in the SOAP body',
			},
			{
				displayName: 'Service Namespace',
				name: 'serviceNamespace',
				type: 'string',
				default: 'http://tempuri.org/',
				description: 'WSDL service namespace',
			},
			{
				displayName: 'Data Contract Namespace',
				name: 'dataContractNamespace',
				type: 'string',
				default: 'http://schemas.datacontract.org/2004/07/IntegrationHub',
			},
			{
				displayName: 'Service Name',
				name: 'serviceName',
				type: 'string',
				default: 'IntegrationHubService',
				description: 'WSDL service adı',
			},
			{
				displayName: 'Port Type Name',
				name: 'portTypeName',
				type: 'string',
				default: '',
				description: 'Boş bırakılırsa I{ServiceName} kullanılır',
			},
			{
				displayName: 'SOAP 1.1 Port Location',
				name: 'soap11PortLocation',
				type: 'string',
				default: '',
				description: 'Örn: http://localhost:5678/webhook-test/dynamic.wsdl',
			},
			{
				displayName: 'SOAP 1.2 Port Location',
				name: 'soap12PortLocation',
				type: 'string',
				default: '',
				description: 'Örn: http://localhost:5678/webhook-test/dynamic.wsdl',
			},
			{
				displayName: 'Include SOAP 1.1 Binding',
				name: 'includeSoap11Binding',
				type: 'boolean',
				default: true,
			},
			{
				displayName: 'Include SOAP 1.2 Binding',
				name: 'includeSoap12Binding',
				type: 'boolean',
				default: true,
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const operation = this.getNodeParameter('operation', 0) as string;
		const serviceNamespace = this.getNodeParameter('serviceNamespace', 0) as string;
		const dataContractNamespace = this.getNodeParameter('dataContractNamespace', 0) as string;
		const serviceName = this.getNodeParameter('serviceName', 0) as string;
		const portTypeNameParam = ((this.getNodeParameter('portTypeName', 0) as string) ?? '').trim();
		const portTypeName = portTypeNameParam || `I${serviceName}`;
		const useWrapperElement = this.getNodeParameter('useWrapperElement', 0, true) as boolean;
		const soap11PortLocation = (this.getNodeParameter('soap11PortLocation', 0) as string) ?? '';
		const soap12PortLocation = (this.getNodeParameter('soap12PortLocation', 0) as string) ?? '';
		const includeSoap11Binding = this.getNodeParameter('includeSoap11Binding', 0, true) as boolean;
		const includeSoap12Binding = this.getNodeParameter('includeSoap12Binding', 0, true) as boolean;

		const node = this.getNode();

		if (operation === 'generateWsdl') {
			const aggregatedWorkflows: Workflow[] = [];

			for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
				const workflowListInput = this.getNodeParameter('workflowList', itemIndex) as unknown;
				const workflows = normalizeWorkflowList(workflowListInput, node);
				aggregatedWorkflows.push(...workflows);
			}

			if (aggregatedWorkflows.length === 0) {
				throw new NodeOperationError(node, 'Workflow listesi boş olamaz.');
			}

			const wsdlContent = generateWsdl(
				aggregatedWorkflows,
				serviceNamespace,
				dataContractNamespace,
				serviceName,
				portTypeName,
				includeSoap11Binding,
				includeSoap12Binding,
				soap11PortLocation,
				soap12PortLocation,
				useWrapperElement,
			);

			const baseJson = items[0]?.json ?? {};
			const outputItem: INodeExecutionData = {
				json: {
					...baseJson,
					wsdl: wsdlContent,
					serviceName,
					workflowCount: aggregatedWorkflows.length,
				},
			};

			if (items.length > 0) {
				outputItem.pairedItem = { item: 0 };
			}

			return [[outputItem]];
		}

		return [items];
	}

	// @ts-expect-error - Custom method, gelecekte kullanılacak
	private _normalizeWorkflowList(input: unknown, node: INode): Workflow[] {
		if (Array.isArray(input)) {
			return input as Workflow[];
		}

		if (typeof input === 'string') {
			try {
				const parsed = JSON.parse(input);
				if (!Array.isArray(parsed)) {
					throw new NodeOperationError(node, 'Workflow listesi bir dizi olmalıdır.');
				}
				return parsed as Workflow[];
			} catch (error) {
				throw new NodeOperationError(node, `Geçersiz JSON formatı: ${error}`);
			}
		}

		throw new NodeOperationError(node, 'Workflow listesi geçersiz formatta.');
	}

	private parseNotes(notes: string): ParsedParameter[] {
		if (!notes) return [];

		const lines = notes.split('\n');
		const parameters: ParsedParameter[] = [];

		for (const line of lines) {
			const trimmed = line.trim();
			if (!trimmed.startsWith('@')) continue;

			// @ SupplierCode string required
			// @ Currency enum required (TRY-EUR-USD)
			const match = trimmed.match(/@\s*(\w+)\s+(\w+)\s+(required|optional)(?:\s+\(([^)]+)\))?/);
			if (!match) continue;

			const [, name, type, requiredStr, enumValuesStr] = match;
			const required = requiredStr === 'required';
			const enumValues = enumValuesStr ? enumValuesStr.split('-').map((v) => v.trim()) : undefined;

			parameters.push({
				name: name.trim(),
				type: this.mapTypeToXsd(type.trim()),
				required,
				enumValues,
			});
		}

		return parameters;
	}

	private mapTypeToXsd(type: string): string {
		const typeMap: Record<string, string> = {
			string: 'xs:string',
			number: 'xs:decimal',
			decimal: 'xs:decimal',
			dateTime: 'xs:string', // Example WSDL'de dateTime için xs:string kullanılıyor
			any: 'xs:string',
			enum: 'xs:string',
		};

		return typeMap[type.toLowerCase()] || 'xs:string';
	}

	// @ts-expect-error - Custom method, gelecekte kullanılacak
	private _generateWsdl(
		workflows: Workflow[],
		serviceNamespace: string,
		dataContractNamespace: string,
		serviceName: string,
	): string {
		const operations: string[] = [];
		const types: string[] = [];
		const messages: string[] = [];
		const portTypeOperations: string[] = [];
		const bindingOperations: string[] = [];

		// Tüm enum'ları topla (tekrar etmemek için)
		const enumTypes = new Map<string, string[]>();

		// İlk önce tüm enum'ları topla
		for (const workflow of workflows) {
			if (!workflow.nodes || workflow.nodes.length === 0) continue;

			const triggerNode = workflow.nodes.find(
				(node) => node.type === 'n8n-nodes-base.executeWorkflowTrigger',
			);
			if (!triggerNode || !triggerNode.notes) continue;

			const parameters = this.extractParameters(triggerNode);
			for (const param of parameters) {
				if (param.enumValues && param.enumValues.length > 0) {
					const enumName = this.capitalizeFirst(param.name);
					if (!enumTypes.has(enumName)) {
						enumTypes.set(enumName, param.enumValues);
					}
				}
			}
		}

		// Enum types oluştur (sadece bir kez)
		for (const [enumName, enumValues] of enumTypes.entries()) {
			const enumRestrictions = enumValues.map((val) => `<xs:enumeration value="${val}"/>`).join('');

			types.push(
				`<xs:simpleType name="${enumName}"><xs:restriction base="xs:string">${enumRestrictions}</xs:restriction></xs:simpleType><xs:element name="${enumName}" nillable="true" type="tns:${enumName}"/>`,
			);
		}

		// Her workflow için operation oluştur
		for (const workflow of workflows) {
			if (!workflow.nodes || workflow.nodes.length === 0) continue;

			const triggerNode = workflow.nodes.find(
				(node) => node.type === 'n8n-nodes-base.executeWorkflowTrigger',
			);
			if (!triggerNode || !triggerNode.notes) continue;

			const parameters = this.extractParameters(triggerNode);
			if (parameters.length === 0) continue;

			const operationName = this.capitalizeFirst(workflow.name);
			const requestTypeName = `${operationName}Request`;
			const responseTypeName = `${operationName}Response`;
			const responseWrapperTypeName = `DbsResponseOf${operationName}bfzVA3Hm`;

			// Request type oluştur
			const requestElements = parameters
				.map((param) => {
					const type = param.enumValues ? `tns:${this.capitalizeFirst(param.name)}` : param.type;
					return `<xs:element minOccurs="0" name="${param.name}" nillable="true" type="${type}"/>`;
				})
				.join('');

			types.push(
				`<xs:complexType name="${requestTypeName}"><xs:sequence>${requestElements}</xs:sequence></xs:complexType><xs:element name="${requestTypeName}" nillable="true" type="tns:${requestTypeName}"/>`,
			);

			// Response wrapper type oluştur (DbsResponseOf... formatında)
			types.push(
				`<xs:complexType name="${responseWrapperTypeName}"><xs:sequence><xs:element minOccurs="0" name="ResponseCode" nillable="true" type="xs:string"/><xs:element minOccurs="0" name="ResponseMessage" nillable="true" type="xs:string"/><xs:element minOccurs="0" name="Value" nillable="true" type="xs:string"/></xs:sequence></xs:complexType><xs:element name="${responseWrapperTypeName}" nillable="true" type="tns:${responseWrapperTypeName}"/>`,
			);

			// Operation elements (service namespace'de)
			const qPrefix = `q${operations.length + 1}`;
			operations.push(
				`<xs:element name="${operationName}"><xs:complexType><xs:sequence><xs:element minOccurs="0" name="request" nillable="true" type="${qPrefix}:${requestTypeName}" xmlns:${qPrefix}="${dataContractNamespace}"/></xs:sequence></xs:complexType></xs:element><xs:element name="${responseTypeName}"><xs:complexType><xs:sequence><xs:element minOccurs="0" name="${operationName}Result" nillable="true" type="${qPrefix}:${responseWrapperTypeName}" xmlns:${qPrefix}="${dataContractNamespace}"/></xs:sequence></xs:complexType></xs:element>`,
			);

			// Messages
			messages.push(
				`<wsdl:message name="I${serviceName}_${operationName}_InputMessage"><wsdl:part name="parameters" element="tns:${operationName}"/></wsdl:message><wsdl:message name="I${serviceName}_${operationName}_OutputMessage"><wsdl:part name="parameters" element="tns:${responseTypeName}"/></wsdl:message>`,
			);

			// PortType operations
			portTypeOperations.push(
				`<wsdl:operation name="${operationName}"><wsdl:input wsaw:Action="${serviceNamespace}I${serviceName}/${operationName}" message="tns:I${serviceName}_${operationName}_InputMessage"/><wsdl:output wsaw:Action="${serviceNamespace}I${serviceName}/${operationName}Response" message="tns:I${serviceName}_${operationName}_OutputMessage"/></wsdl:operation>`,
			);

			// Binding operations
			bindingOperations.push(
				`<wsdl:operation name="${operationName}"><soap:operation soapAction="${serviceNamespace}I${serviceName}/${operationName}" style="document"/><wsdl:input><soap:body use="literal"/></wsdl:input><wsdl:output><soap:body use="literal"/></wsdl:output></wsdl:operation>`,
			);
		}

		// Microsoft Serialization namespace için temel tipler (single line format)
		const serializationTypes = `<xs:schema attributeFormDefault="qualified" elementFormDefault="qualified" targetNamespace="http://schemas.microsoft.com/2003/10/Serialization/" xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:tns="http://schemas.microsoft.com/2003/10/Serialization/"><xs:element name="anyType" nillable="true" type="xs:anyType"/><xs:element name="anyURI" nillable="true" type="xs:anyURI"/><xs:element name="base64Binary" nillable="true" type="xs:base64Binary"/><xs:element name="boolean" nillable="true" type="xs:boolean"/><xs:element name="byte" nillable="true" type="xs:byte"/><xs:element name="dateTime" nillable="true" type="xs:dateTime"/><xs:element name="decimal" nillable="true" type="xs:decimal"/><xs:element name="double" nillable="true" type="xs:double"/><xs:element name="float" nillable="true" type="xs:float"/><xs:element name="int" nillable="true" type="xs:int"/><xs:element name="long" nillable="true" type="xs:long"/><xs:element name="QName" nillable="true" type="xs:QName"/><xs:element name="short" nillable="true" type="xs:short"/><xs:element name="string" nillable="true" type="xs:string"/><xs:element name="unsignedByte" nillable="true" type="xs:unsignedByte"/><xs:element name="unsignedInt" nillable="true" type="xs:unsignedInt"/><xs:element name="unsignedLong" nillable="true" type="xs:unsignedLong"/><xs:element name="unsignedShort" nillable="true" type="xs:unsignedShort"/><xs:element name="char" nillable="true" type="tns:char"/><xs:simpleType name="char"><xs:restriction base="xs:int"/></xs:simpleType><xs:element name="duration" nillable="true" type="tns:duration"/><xs:simpleType name="duration"><xs:restriction base="xs:duration"><xs:pattern value="\-?P(\d*D)?(T(\d*H)?(\d*M)?(\d*(\.\d*)?S)?)?"/><xs:minInclusive value="-P10675199DT2H48M5.4775808S"/><xs:maxInclusive value="P10675199DT2H48M5.4775807S"/></xs:restriction></xs:simpleType><xs:element name="guid" nillable="true" type="tns:guid"/><xs:simpleType name="guid"><xs:restriction base="xs:string"><xs:pattern value="[\da-fA-F]{8}-[\da-fA-F]{4}-[\da-fA-F]{4}-[\da-fA-F]{4}-[\da-fA-F]{12}"/></xs:restriction></xs:simpleType><xs:attribute name="FactoryType" type="xs:QName"/><xs:attribute name="Id" type="xs:ID"/><xs:attribute name="Ref" type="xs:IDREF"/></xs:schema>`;

		// Single line WSDL format (example dosyasındaki gibi)
		const wsdl = `<?xml version="1.0" encoding="utf-8"?><wsdl:definitions name="${serviceName}" targetNamespace="${serviceNamespace}" xmlns:wsdl="http://schemas.xmlsoap.org/wsdl/" xmlns:wsam="http://www.w3.org/2007/05/addressing/metadata" xmlns:wsx="http://schemas.xmlsoap.org/ws/2004/09/mex" xmlns:wsap="http://schemas.xmlsoap.org/ws/2004/08/addressing/policy" xmlns:msc="http://schemas.microsoft.com/ws/2005/12/wsdl/contract" xmlns:wsp="http://schemas.xmlsoap.org/ws/2004/09/policy" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap="http://schemas.xmlsoap.org/wsdl/soap/" xmlns:wsu="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd" xmlns:soap12="http://schemas.xmlsoap.org/wsdl/soap12/" xmlns:soapenc="http://schemas.xmlsoap.org/soap/encoding/" xmlns:tns="${serviceNamespace}" xmlns:wsa10="http://www.w3.org/2005/08/addressing" xmlns:wsaw="http://www.w3.org/2006/05/addressing/wsdl" xmlns:wsa="http://schemas.xmlsoap.org/ws/2004/08/addressing"><wsdl:types><xs:schema elementFormDefault="qualified" targetNamespace="${serviceNamespace}" xmlns:xs="http://www.w3.org/2001/XMLSchema"><xs:import namespace="${dataContractNamespace}"/>${operations.join('')}</xs:schema>${serializationTypes}<xs:schema elementFormDefault="qualified" targetNamespace="${dataContractNamespace}" xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:tns="${dataContractNamespace}"><xs:import namespace="http://schemas.microsoft.com/2003/10/Serialization"/>${types.join('')}</xs:schema></wsdl:types>${messages.join('')}<wsdl:portType name="I${serviceName}">${portTypeOperations.join('')}</wsdl:portType><wsdl:binding name="BasicHttpBinding_I${serviceName}" type="tns:I${serviceName}"><soap:binding transport="http://schemas.xmlsoap.org/soap/http"/>${bindingOperations.join('')}</wsdl:binding><wsdl:service name="${serviceName}"><wsdl:port name="BasicHttpBinding_I${serviceName}" binding="tns:BasicHttpBinding_I${serviceName}"><soap:address location="http://localhost/${serviceName}.svc/Basic"/></wsdl:port></wsdl:service></wsdl:definitions>`;

		return wsdl;
	}

	private extractParameters(node: WorkflowNode): ParsedParameter[] {
		const noteParameters = node.notes ? this.parseNotes(node.notes) : [];
		if (noteParameters.length > 0) {
			return noteParameters;
		}

		const workflowInputs = node.parameters?.workflowInputs?.values ?? [];
		return workflowInputs
			.map((input) => {
				const name = input.name?.trim();
				if (!name) return null;
				const type = this.mapTypeToXsd((input.type ?? 'string').trim());
				return {
					name,
					type,
					required: false,
				};
			})
			.filter((param): param is ParsedParameter => param !== null);
	}

	private capitalizeFirst(str: string): string {
		return str.charAt(0).toUpperCase() + str.slice(1).replace(/\s+/g, '');
	}
}
