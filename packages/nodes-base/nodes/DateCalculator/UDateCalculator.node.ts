import type {
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	IDataObject,
} from 'n8n-workflow';
import { ApplicationError } from 'n8n-workflow';

interface DateCalculationResult {
	date: string;
	date_start?: string;
	date_end?: string;
	timestamp?: number;
}

const formatDate = (date: Date, format: string): string => {
	const year = date.getFullYear();
	const month = String(date.getMonth() + 1).padStart(2, '0');
	const day = String(date.getDate()).padStart(2, '0');

	return format
		.replace('yyyy', String(year))
		.replace('MM', month)
		.replace('dd', day)
		.replace('yy', String(year).substring(2));
};

const isWeekend = (date: Date): boolean => {
	const day = date.getDay();
	return day === 0 || day === 6; // 0 = Pazar, 6 = Cumartesi
};

const isHoliday = (date: Date): boolean => {
	// Türkiye resmi tatilleri (2024-2025)
	const month = date.getMonth() + 1;
	const day = date.getDate();

	// Sabit tatiller
	if (month === 1 && day === 1) return true; // Yılbaşı
	if (month === 4 && day === 23) return true; // Ulusal Egemenlik ve Çocuk Bayramı
	if (month === 5 && day === 1) return true; // Emek ve Dayanışma Günü
	if (month === 5 && day === 19) return true; // Atatürk'ü Anma, Gençlik ve Spor Bayramı
	if (month === 7 && day === 15) return true; // Demokrasi ve Milli Birlik Günü
	if (month === 8 && day === 30) return true; // Zafer Bayramı
	if (month === 10 && day === 29) return true; // Cumhuriyet Bayramı

	// Dini bayramlar (yaklaşık - gerçek hesaplama için daha gelişmiş algoritma gerekir)
	// Bu basit bir örnek, gerçek projede dini bayramlar için özel hesaplama yapılmalı

	return false;
};

const getBusinessDay = (date: Date, excludeWeekends: boolean, excludeHolidays: boolean): Date => {
	let currentDate = new Date(date);

	while (excludeWeekends && isWeekend(currentDate)) {
		currentDate.setDate(currentDate.getDate() + 1);
	}

	while (excludeHolidays && isHoliday(currentDate)) {
		currentDate.setDate(currentDate.getDate() + 1);
		if (excludeWeekends && isWeekend(currentDate)) {
			currentDate.setDate(currentDate.getDate() + 1);
		}
	}

	return currentDate;
};

const calculateDate = (
	operation: string,
	params: IDataObject,
	baseDate?: Date,
): DateCalculationResult => {
	const base = baseDate || new Date();
	const monthOffset = (params.month_offset as number) || 0;
	const yearOffset = (params.year_offset as number) || 0;
	const day = (params.day as number) || 1;
	const n = (params.n as number) || 7;
	const offset = (params.offset as number) || 0;
	const excludeWeekends = (params.exclude_weekends as boolean) || false;
	const excludeHolidays = (params.exclude_holidays as boolean) || false;
	const outputFormat = (params.output_format as string) || 'yyyy-MM-dd';

	let resultDate: Date;
	let dateStart: Date | undefined;
	let dateEnd: Date | undefined;

	switch (operation) {
		case 'bu_ay_X': {
			const targetDate = new Date(
				base.getFullYear() + yearOffset,
				base.getMonth() + monthOffset,
				day,
			);
			resultDate = getBusinessDay(targetDate, excludeWeekends, excludeHolidays);
			break;
		}

		case 'gecen_ay_X': {
			const targetDate = new Date(
				base.getFullYear() + yearOffset,
				base.getMonth() + monthOffset - 1,
				day,
			);
			resultDate = getBusinessDay(targetDate, excludeWeekends, excludeHolidays);
			break;
		}

		case 'ay_basi': {
			const targetDate = new Date(
				base.getFullYear() + yearOffset,
				base.getMonth() + monthOffset,
				1,
			);
			resultDate = getBusinessDay(targetDate, excludeWeekends, excludeHolidays);
			break;
		}

		case 'ay_sonu': {
			const targetDate = new Date(
				base.getFullYear() + yearOffset,
				base.getMonth() + monthOffset + 1,
				0,
			);
			resultDate = getBusinessDay(targetDate, excludeWeekends, excludeHolidays);
			break;
		}

		case 'bugun': {
			resultDate = getBusinessDay(new Date(base), excludeWeekends, excludeHolidays);
			break;
		}

		case 'dun': {
			const yesterday = new Date(base);
			yesterday.setDate(yesterday.getDate() - 1);
			resultDate = getBusinessDay(yesterday, excludeWeekends, excludeHolidays);
			break;
		}

		case 'yarin': {
			const tomorrow = new Date(base);
			tomorrow.setDate(tomorrow.getDate() + 1);
			resultDate = getBusinessDay(tomorrow, excludeWeekends, excludeHolidays);
			break;
		}

		case 'relative_day': {
			const targetDate = new Date(base);
			targetDate.setDate(targetDate.getDate() + offset);
			resultDate = getBusinessDay(targetDate, excludeWeekends, excludeHolidays);
			break;
		}

		case 'last_n_days': {
			dateEnd = new Date(base);
			dateStart = new Date(base);
			dateStart.setDate(dateStart.getDate() - n + 1);
			resultDate = dateStart;
			break;
		}

		case 'next_n_days': {
			dateStart = new Date(base);
			dateEnd = new Date(base);
			dateEnd.setDate(dateEnd.getDate() + n - 1);
			resultDate = dateStart;
			break;
		}

		case 'quarter_start': {
			const quarter = Math.floor(base.getMonth() / 3);
			const targetDate = new Date(
				base.getFullYear() + yearOffset,
				quarter * 3 + monthOffset * 3,
				1,
			);
			resultDate = getBusinessDay(targetDate, excludeWeekends, excludeHolidays);
			break;
		}

		case 'quarter_end': {
			const quarter = Math.floor(base.getMonth() / 3);
			const targetDate = new Date(
				base.getFullYear() + yearOffset,
				(quarter + 1) * 3 + monthOffset * 3,
				0,
			);
			resultDate = getBusinessDay(targetDate, excludeWeekends, excludeHolidays);
			break;
		}

		case 'year_start': {
			const targetDate = new Date(base.getFullYear() + yearOffset, 0 + monthOffset, 1);
			resultDate = getBusinessDay(targetDate, excludeWeekends, excludeHolidays);
			break;
		}

		case 'year_end': {
			const targetDate = new Date(base.getFullYear() + yearOffset, 11 + monthOffset, 31);
			resultDate = getBusinessDay(targetDate, excludeWeekends, excludeHolidays);
			break;
		}

		case 'weekday_nth': {
			const weekNumber = (params.week_number as number) || 1; // 1 = ilk, 2 = ikinci, vb.
			const weekday = (params.weekday as number) || 1; // 0 = Pazar, 1 = Pazartesi, ..., 6 = Cumartesi

			const firstDayOfMonth = new Date(
				base.getFullYear() + yearOffset,
				base.getMonth() + monthOffset,
				1,
			);
			const firstWeekday = firstDayOfMonth.getDay();
			let dayOffset = weekday - firstWeekday;
			if (dayOffset < 0) dayOffset += 7;
			dayOffset += (weekNumber - 1) * 7;

			const targetDate = new Date(firstDayOfMonth);
			targetDate.setDate(targetDate.getDate() + dayOffset);
			resultDate = getBusinessDay(targetDate, excludeWeekends, excludeHolidays);
			break;
		}

		default:
			throw new ApplicationError(`Bilinmeyen operation: ${operation}`);
	}

	return {
		date: formatDate(resultDate, outputFormat),
		date_start: dateStart ? formatDate(dateStart, outputFormat) : undefined,
		date_end: dateEnd ? formatDate(dateEnd, outputFormat) : undefined,
		timestamp: resultDate.getTime(),
	};
};

const parseMethodName = (methodName: string): { operation: string; params: IDataObject } => {
	// gecen_ay_26 -> gecen_ay_X, day=26
	if (methodName.startsWith('gecen_ay_')) {
		const day = parseInt(methodName.replace('gecen_ay_', ''), 10);
		if (!isNaN(day)) {
			return { operation: 'gecen_ay_X', params: { day } };
		}
	}

	// bu_ay_26 -> bu_ay_X, day=26
	if (methodName.startsWith('bu_ay_')) {
		const day = parseInt(methodName.replace('bu_ay_', ''), 10);
		if (!isNaN(day)) {
			return { operation: 'bu_ay_X', params: { day } };
		}
	}

	// relative_day_7 -> relative_day, offset=7
	if (methodName.startsWith('relative_day_')) {
		const offset = parseInt(methodName.replace('relative_day_', ''), 10);
		if (!isNaN(offset)) {
			return { operation: 'relative_day', params: { offset } };
		}
	}

	// last_n_days_7 -> last_n_days, n=7
	if (methodName.startsWith('last_n_days_')) {
		const n = parseInt(methodName.replace('last_n_days_', ''), 10);
		if (!isNaN(n)) {
			return { operation: 'last_n_days', params: { n } };
		}
	}

	// next_n_days_7 -> next_n_days, n=7
	if (methodName.startsWith('next_n_days_')) {
		const n = parseInt(methodName.replace('next_n_days_', ''), 10);
		if (!isNaN(n)) {
			return { operation: 'next_n_days', params: { n } };
		}
	}

	// Direkt metod adı (bugun, dun, yarin, ay_basi, ay_sonu, vb.)
	return { operation: methodName, params: {} };
};

const formatDateWithLength = (dateStr: string, length?: string, format?: string): string => {
	if (!length) return dateStr;

	const lengthNum = parseInt(length, 10);
	if (isNaN(lengthNum) || lengthNum <= 0) return dateStr;

	// Length'e göre kırp veya pad
	if (dateStr.length > lengthNum) {
		return dateStr.substring(0, lengthNum);
	} else if (dateStr.length < lengthNum) {
		// Eğer format yyyyMMdd gibi sayısal ise, sağa 0 ekle
		// Diğer formatlarda boşluk ekle
		if (format && /^[yMd]+$/.test(format.replace(/[^yMd]/g, ''))) {
			return dateStr.padEnd(lengthNum, '0');
		} else {
			return dateStr.padEnd(lengthNum, ' ');
		}
	}

	return dateStr;
};

const parseParams = (paramsString: string): IDataObject => {
	const params: IDataObject = {};
	if (!paramsString || !paramsString.trim()) {
		return params;
	}

	const pairs = paramsString.split(',');
	for (const pair of pairs) {
		const trimmed = pair.trim();
		if (!trimmed) continue;

		const [key, value] = trimmed.split('=').map((s) => s.trim());
		if (!key) continue;

		// Boolean değerleri
		if (value === 'true' || value === 'false') {
			params[key] = value === 'true';
		}
		// Sayısal değerler
		else if (!isNaN(Number(value)) && value !== '') {
			params[key] = Number(value);
		}
		// String değerler
		else {
			params[key] = value || '';
		}
	}

	return params;
};

export class UDateCalculator implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'U_Date_Calculator',
		name: 'uDateCalculator',
		icon: 'fa:calendar',
		group: ['transform'],
		version: 1,
		subtitle: 'BeginDate & EndDate',
		description: 'Tarih hesaplama ve manipülasyon işlemleri',
		defaults: {
			name: 'U_Date_Calculator',
		},
		inputs: ['main'],
		outputs: ['main'],
		properties: [
			{
				displayName: 'Operation Mode',
				name: 'operationMode',
				type: 'options',
				options: [
					{
						name: 'BeginDate & EndDate',
						value: 'beginEnd',
					},
					{
						name: 'Field Based',
						value: 'fieldBased',
					},
				],
				default: 'beginEnd',
				description: 'Hesaplama modu',
			},
			{
				displayName: 'BeginDate Field Name',
				name: 'beginDateName',
				type: 'string',
				displayOptions: {
					show: {
						operationMode: ['fieldBased'],
					},
				},
				default: 'BeginDate',
				description: 'Çıktı field adı',
			},
			{
				displayName: 'BeginDate Length',
				name: 'beginDateLength',
				type: 'string',
				displayOptions: {
					show: {
						operationMode: ['fieldBased'],
					},
				},
				default: '8',
				description: 'Çıktı uzunluğu',
			},
			{
				displayName: 'BeginDate Metod',
				name: 'beginDateMetod',
				type: 'string',
				displayOptions: {
					show: {
						operationMode: ['fieldBased'],
					},
				},
				default: 'gecen_ay_26',
				description: 'Tarih hesaplama metodu',
			},
			{
				displayName: 'BeginDate Output Type',
				name: 'beginDateOutputType',
				type: 'string',
				displayOptions: {
					show: {
						operationMode: ['fieldBased'],
					},
				},
				default: 'yyyyMMdd',
				description: 'Tarih formatı (yyyy-MM-dd, dd/MM/yyyy, dd.MM.yyyy, yyyyMMdd)',
			},
			{
				displayName: 'EndDate Field Name',
				name: 'endDateName',
				type: 'string',
				displayOptions: {
					show: {
						operationMode: ['fieldBased'],
					},
				},
				default: 'EndDate',
				description: 'Çıktı field adı',
			},
			{
				displayName: 'EndDate Length',
				name: 'endDateLength',
				type: 'string',
				displayOptions: {
					show: {
						operationMode: ['fieldBased'],
					},
				},
				default: '8',
				description: 'Çıktı uzunluğu',
			},
			{
				displayName: 'EndDate Metod',
				name: 'endDateMetod',
				type: 'string',
				displayOptions: {
					show: {
						operationMode: ['fieldBased'],
					},
				},
				default: 'bu_ay_26',
				description: 'Tarih hesaplama metodu',
			},
			{
				displayName: 'EndDate Output Type',
				name: 'endDateOutputType',
				type: 'string',
				displayOptions: {
					show: {
						operationMode: ['fieldBased'],
					},
				},
				default: 'yyyyMMdd',
				description: 'Tarih formatı (yyyy-MM-dd, dd/MM/yyyy, dd.MM.yyyy, yyyyMMdd)',
			},
			{
				displayName: 'BeginDate Method',
				name: 'beginDateMethod',
				type: 'options',
				displayOptions: {
					show: {
						operationMode: ['beginEnd'],
					},
				},
				/* eslint-disable n8n-nodes-base/node-param-display-name-miscased */
				options: [
					{
						name: 'ay_basi',
						value: 'ay_basi',
					},
					{
						name: 'ay_sonu',
						value: 'ay_sonu',
					},
					{
						name: 'bu_ay_X',
						value: 'bu_ay_X',
					},
					{
						name: 'bugun',
						value: 'bugun',
					},
					{
						name: 'dun',
						value: 'dun',
					},
					{
						name: 'gecen_ay_X',
						value: 'gecen_ay_X',
					},
					{
						name: 'last_n_days',
						value: 'last_n_days',
					},
					{
						name: 'next_n_days',
						value: 'next_n_days',
					},
					{
						name: 'quarter_end',
						value: 'quarter_end',
					},
					{
						name: 'quarter_start',
						value: 'quarter_start',
					},
					{
						name: 'relative_day',
						value: 'relative_day',
					},
					{
						name: 'weekday_nth',
						value: 'weekday_nth',
					},
					{
						name: 'yarin',
						value: 'yarin',
					},
					{
						name: 'year_end',
						value: 'year_end',
					},
					{
						name: 'year_start',
						value: 'year_start',
					},
				],
				/* eslint-enable n8n-nodes-base/node-param-display-name-miscased */
				default: 'bu_ay_X',
				description: 'Başlangıç tarihi için metod',
			},
			{
				displayName: 'BeginDate Method Açıklama',
				name: 'beginDateMethodHelp',
				type: 'notice',
				displayOptions: {
					show: {
						operationMode: ['beginEnd'],
					},
				},
				default: '',
				typeOptions: {
					message:
						'Metodlar: bu_ay_X, gecen_ay_X, ay_basi, ay_sonu, bugun, dun, yarin, quarter_start, quarter_end, year_start, year_end, weekday_nth',
				},
			},
			{
				displayName: 'BeginDate Params',
				name: 'beginDateParams',
				type: 'string',
				displayOptions: {
					show: {
						operationMode: ['beginEnd'],
					},
				},
				typeOptions: {
					rows: 3,
				},
				default: 'day=26,month_offset=0,year_offset=0',
				description: 'Parametreler (örn: day=26,month_offset=0,year_offset=0)',
			},
			{
				displayName: 'BeginDate Params Açıklama',
				name: 'beginDateParamsHelp',
				type: 'notice',
				displayOptions: {
					show: {
						operationMode: ['beginEnd'],
					},
				},
				default: '',
				typeOptions: {
					message:
						'Parametreler: day (1-31), month_offset (-12 ile +12), year_offset, n, offset, week_number, weekday (0-6), exclude_weekends (true/false), exclude_holidays (true/false). Format: key=value,key2=value2',
				},
			},
			{
				displayName: 'EndDate Method',
				name: 'endDateMethod',
				type: 'options',
				displayOptions: {
					show: {
						operationMode: ['beginEnd'],
					},
				},
				/* eslint-disable n8n-nodes-base/node-param-display-name-miscased */
				options: [
					{
						name: 'ay_basi',
						value: 'ay_basi',
					},
					{
						name: 'ay_sonu',
						value: 'ay_sonu',
					},
					{
						name: 'bu_ay_X',
						value: 'bu_ay_X',
					},
					{
						name: 'bugun',
						value: 'bugun',
					},
					{
						name: 'dun',
						value: 'dun',
					},
					{
						name: 'gecen_ay_X',
						value: 'gecen_ay_X',
					},
					{
						name: 'last_n_days',
						value: 'last_n_days',
					},
					{
						name: 'next_n_days',
						value: 'next_n_days',
					},
					{
						name: 'quarter_end',
						value: 'quarter_end',
					},
					{
						name: 'quarter_start',
						value: 'quarter_start',
					},
					{
						name: 'relative_day',
						value: 'relative_day',
					},
					{
						name: 'weekday_nth',
						value: 'weekday_nth',
					},
					{
						name: 'yarin',
						value: 'yarin',
					},
					{
						name: 'year_end',
						value: 'year_end',
					},
					{
						name: 'year_start',
						value: 'year_start',
					},
				],
				/* eslint-enable n8n-nodes-base/node-param-display-name-miscased */
				default: 'relative_day',
				description: 'Bitiş tarihi için metod',
			},
			{
				displayName: 'EndDate Method Açıklama',
				name: 'endDateMethodHelp',
				type: 'notice',
				displayOptions: {
					show: {
						operationMode: ['beginEnd'],
					},
				},
				default: '',
				typeOptions: {
					message:
						'Metodlar: relative_day, yarin, next_n_days, ay_sonu, quarter_end, year_end, weekday_nth',
				},
			},
			{
				displayName: 'EndDate Params',
				name: 'endDateParams',
				type: 'string',
				displayOptions: {
					show: {
						operationMode: ['beginEnd'],
					},
				},
				typeOptions: {
					rows: 3,
				},
				default: 'offset=0,month_offset=0,year_offset=0',
				description: 'Parametreler (örn: offset=0,month_offset=0,year_offset=0)',
			},
			{
				displayName: 'EndDate Params Açıklama',
				name: 'endDateParamsHelp',
				type: 'notice',
				displayOptions: {
					show: {
						operationMode: ['beginEnd'],
					},
				},
				default: '',
				typeOptions: {
					message:
						'Parametreler: day (1-31), month_offset (-12 ile +12), year_offset, n, offset, week_number, weekday (0-6), exclude_weekends (true/false), exclude_holidays (true/false). Format: key=value,key2=value2',
				},
			},
			{
				displayName: 'Output Format',
				name: 'output_format',
				type: 'options',
				displayOptions: {
					show: {
						operationMode: ['beginEnd'],
					},
				},
				options: [
					{
						name: 'Yyyy-MM-Dd',
						value: 'yyyy-MM-dd',
					},
					{
						name: 'dd/MM/yyyy',
						value: 'dd/MM/yyyy',
					},
					{
						name: 'dd.MM.yyyy',
						value: 'dd.MM.yyyy',
					},
					{
						name: 'yyyyMMdd',
						value: 'yyyyMMdd',
					},
				],
				default: 'yyyy-MM-dd',
				description: 'Çıktı tarih formatı',
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
			try {
				const operationMode = this.getNodeParameter(
					'operationMode',
					itemIndex,
					'beginEnd',
				) as string;

				if (operationMode === 'fieldBased') {
					// Field-based calculation
					const beginDateName = this.getNodeParameter(
						'beginDateName',
						itemIndex,
						'BeginDate',
					) as string;
					const beginDateLength = this.getNodeParameter(
						'beginDateLength',
						itemIndex,
						'8',
					) as string;
					const beginDateMetod = this.getNodeParameter(
						'beginDateMetod',
						itemIndex,
						'gecen_ay_26',
					) as string;
					const beginDateOutputType = this.getNodeParameter(
						'beginDateOutputType',
						itemIndex,
						'yyyyMMdd',
					) as string;

					const endDateName = this.getNodeParameter('endDateName', itemIndex, 'EndDate') as string;
					const endDateLength = this.getNodeParameter('endDateLength', itemIndex, '8') as string;
					const endDateMetod = this.getNodeParameter(
						'endDateMetod',
						itemIndex,
						'bu_ay_26',
					) as string;
					const endDateOutputType = this.getNodeParameter(
						'endDateOutputType',
						itemIndex,
						'yyyyMMdd',
					) as string;

					const result: IDataObject = { ...items[itemIndex].json };

					// BeginDate hesapla
					if (beginDateName && beginDateMetod) {
						const { operation, params: methodParams } = parseMethodName(beginDateMetod);
						methodParams.output_format = beginDateOutputType || 'yyyy-MM-dd';
						const dateResult = calculateDate(operation, methodParams);
						let formattedDate = dateResult.date;
						if (beginDateLength) {
							formattedDate = formatDateWithLength(
								formattedDate,
								beginDateLength,
								beginDateOutputType,
							);
						}
						result[beginDateName] = formattedDate;
					}

					// EndDate hesapla
					if (endDateName && endDateMetod) {
						const { operation, params: methodParams } = parseMethodName(endDateMetod);
						methodParams.output_format = endDateOutputType || 'yyyy-MM-dd';
						const dateResult = calculateDate(operation, methodParams);
						let formattedDate = dateResult.date;
						if (endDateLength) {
							formattedDate = formatDateWithLength(formattedDate, endDateLength, endDateOutputType);
						}
						result[endDateName] = formattedDate;
					}

					returnData.push({
						json: result,
						pairedItem: { item: itemIndex },
					});
				} else {
					// BeginDate & EndDate calculation
					const outputFormat = this.getNodeParameter(
						'output_format',
						itemIndex,
						'yyyy-MM-dd',
					) as string;

					// BeginDate hesapla
					const beginDateMethod = this.getNodeParameter(
						'beginDateMethod',
						itemIndex,
						'bu_ay_X',
					) as string;
					const beginDateParamsString = this.getNodeParameter(
						'beginDateParams',
						itemIndex,
						'day=26,month_offset=0,year_offset=0',
					) as string;
					const beginDateParams = parseParams(beginDateParamsString);
					beginDateParams.output_format = outputFormat;
					const beginDateResult = calculateDate(beginDateMethod, beginDateParams);

					// EndDate hesapla
					const endDateMethod = this.getNodeParameter(
						'endDateMethod',
						itemIndex,
						'relative_day',
					) as string;
					const endDateParamsString = this.getNodeParameter(
						'endDateParams',
						itemIndex,
						'offset=0,month_offset=0,year_offset=0',
					) as string;
					const endDateParams = parseParams(endDateParamsString);
					endDateParams.output_format = outputFormat;
					const endDateResult = calculateDate(endDateMethod, endDateParams);

					returnData.push({
						json: {
							...items[itemIndex].json,
							BeginDate: beginDateResult?.date,
							EndDate: endDateResult?.date,
							BeginDate_start: beginDateResult?.date_start,
							BeginDate_end: beginDateResult?.date_end,
							EndDate_start: endDateResult?.date_start,
							EndDate_end: endDateResult?.date_end,
						},
						pairedItem: { item: itemIndex },
					});
				}
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
