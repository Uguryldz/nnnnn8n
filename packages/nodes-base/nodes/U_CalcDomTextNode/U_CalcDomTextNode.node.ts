import { DOMParser } from '@xmldom/xmldom';
import {
	type IExecuteFunctions,
	type INodeExecutionData,
	type INodeType,
	type INodeTypeDescription,
	NodeOperationError,
} from 'n8n-workflow';

// =====================
//  FULL FEATURED TRANSFORMER (FINAL)
//  - Date/DateTime/Dateadd support
//  - pad/align/decimals
//  - expr evaluation (bare identifiers resolve to row then data)
//  - footer calc: count,sum,min,max,avg,sumExpr
//  - filterValue/grouping support
//  - XML schema parser (DOM-based) with description ignore
// =====================

// ---------------------
//  UTIL: safe helpers for expressions
// ---------------------
const exprHelpers = {
	round: (v: number, d: number = 0) => {
		const m = Math.pow(10, d);
		return Math.round(v * m) / m;
	},
	floor: (v: number) => Math.floor(v),
	ceil: (v: number) => Math.ceil(v),
	abs: (v: number) => Math.abs(v),
	min: (...a: number[]) => Math.min(...a),
	max: (...a: number[]) => Math.max(...a),
	sum: (arr: any[]) =>
		Array.isArray(arr) ? arr.reduce((s: number, x: any) => s + (Number(x) || 0), 0) : 0,
	avg: (arr: any[]) =>
		Array.isArray(arr) && arr.length
			? arr.reduce((s: number, x: any) => s + (Number(x) || 0), 0) / arr.length
			: 0,
};

// ---------------------
//  PATH / GETTER
// ---------------------
function getByPath(obj: any, path: string | null): any {
	if (obj == null || path == null) return undefined;
	// allow both slash-separated and dot-separated (normalize)
	const parts = String(path)
		.replace(/\./g, '/')
		.split('/')
		.filter((p) => p !== '');
	let cur = obj;
	for (const p of parts) {
		if (cur == null) return undefined;
		// if numeric index
		if (/^\d+$/.test(p)) {
			cur = cur[Number(p)];
		} else {
			cur = cur[p];
		}
	}
	return cur;
}

// =====================
//  UNIVERSAL DATE CONVERTER (supports all formats)
// =====================

function convertDateUniversal(value: any, inputFmt: string, outputFmt: string): any {
	if (!value || !inputFmt || !outputFmt) return value;

	const parts: any = {
		yyyy: { regex: '(\\d{4})', setter: (o: any, v: string) => (o.yyyy = v) },
		yy: { regex: '(\\d{2})', setter: (o: any, v: string) => (o.yy = v) },
		MM: { regex: '(\\d{2})', setter: (o: any, v: string) => (o.MM = v) },
		dd: { regex: '(\\d{2})', setter: (o: any, v: string) => (o.dd = v) },
	};

	// 1) input format → regex'e dönüştür
	let regexStr = inputFmt;
	Object.keys(parts).forEach((k) => {
		regexStr = regexStr.replace(k, parts[k].regex);
	});

	const regex = new RegExp('^' + regexStr + '$');
	const match = String(value).match(regex);

	if (!match) return value; // uymazsa elleme

	// 2) input formatından tarih parçalarını çıkar
	const extracted: any = {};
	let idx = 1;

	Object.keys(parts).forEach((k) => {
		if (inputFmt.includes(k)) {
			parts[k].setter(extracted, match[idx++]);
		}
	});

	// 3) parçaları tarihe dönüştür
	let yyyy = extracted.yyyy;
	if (!yyyy && extracted.yy) {
		const num = Number(extracted.yy);
		yyyy = num >= 70 ? 1900 + num : 2000 + num;
	}

	const MM = extracted.MM ? Number(extracted.MM) : 1;
	const dd = extracted.dd ? Number(extracted.dd) : 1;

	const dt = new Date(yyyy, MM - 1, dd);

	// 4) output formatı üret
	let out = outputFmt;

	out = out.replace('yyyy', String(dt.getFullYear()));
	out = out.replace('yy', String(dt.getFullYear()).slice(-2));
	out = out.replace('MM', String(dt.getMonth() + 1).padStart(2, '0'));
	out = out.replace('dd', String(dt.getDate()).padStart(2, '0'));

	return out;
}

// =====================
//  TARİH FORMAT MOTORU
// =====================

function formatDateFull(dt: Date, fmt: string): string {
	const dd = String(dt.getDate()).padStart(2, '0');
	const MM = String(dt.getMonth() + 1).padStart(2, '0');
	const yyyy = dt.getFullYear();
	const yy = String(yyyy).slice(-2);

	const HH = String(dt.getHours()).padStart(2, '0');
	const mm = String(dt.getMinutes()).padStart(2, '0');
	const ss = String(dt.getSeconds()).padStart(2, '0');

	return fmt
		.replace('dd', dd)
		.replace('MM', MM)
		.replace('yyyy', String(yyyy))
		.replace('yy', yy)
		.replace('HH', HH)
		.replace('mm', mm)
		.replace('ss', ss);
}

function resolveDateFormat(str: any): any {
	if (!str || typeof str !== 'string') return str;

	// Date_*
	if (str.startsWith('Date_')) {
		const fmt = str.replace('Date_', '');
		return formatDateFull(new Date(), fmt);
	}

	// DateTime_*
	if (str.startsWith('DateTime_')) {
		const fmt = str.replace('DateTime_', '');
		return formatDateFull(new Date(), fmt);
	}

	// Dateadd_Unit_Amount_Format
	if (str.startsWith('Dateadd_')) {
		const parts = str.split('_');
		// parts: ["Dateadd", "Day"|"Month"|"Year", "N", "fmt..."]
		const unit = parts[1];
		const amount = parseInt(parts[2], 10);
		const fmt = parts.slice(3).join('_');
		const dt = new Date();
		if (unit === 'Day') dt.setDate(dt.getDate() + amount);
		else if (unit === 'Month') dt.setMonth(dt.getMonth() + amount);
		else if (unit === 'Year') dt.setFullYear(dt.getFullYear() + amount);
		return formatDateFull(dt, fmt);
	}

	// DateTimeadd_Unit_Amount_Format (e.g. DateTimeadd_Hour_1_yyyyMMddHHmmss)
	if (str.startsWith('DateTimeadd_')) {
		const parts = str.split('_');
		const unit = parts[1];
		const amount = parseInt(parts[2], 10);
		const fmt = parts.slice(3).join('_');
		const dt = new Date();
		if (unit === 'Hour') dt.setHours(dt.getHours() + amount);
		else if (unit === 'Minute') dt.setMinutes(dt.getMinutes() + amount);
		else if (unit === 'Second') dt.setSeconds(dt.getSeconds() + amount);
		else if (unit === 'Day') dt.setDate(dt.getDate() + amount);
		else if (unit === 'Month') dt.setMonth(dt.getMonth() + amount);
		else if (unit === 'Year') dt.setFullYear(dt.getFullYear() + amount);
		return formatDateFull(dt, fmt);
	}

	// Special macros
	if (str === 'PrevMonthLastDay') {
		const now = new Date();
		const dt = new Date(now.getFullYear(), now.getMonth(), 0); // last day previous month
		return formatDateFull(dt, 'ddMMyyyy');
	}
	if (str === 'NextMonthFirstDay') {
		const now = new Date();
		const dt = new Date(now.getFullYear(), now.getMonth() + 1, 1);
		return formatDateFull(dt, 'ddMMyyyy');
	}

	return str;
}

// =====================
//  PADDING FONKSİYONU
// =====================

function pad(
	value: any,
	length: number,
	align: string = 'right',
	padChar: string = ' ',
	decimals?: number,
): string {
	if (value === undefined || value === null) value = '';

	// Resolve date macros (like fixed="Date_yyyyMMdd" etc.)
	if (
		typeof value === 'string' &&
		(value.startsWith('Date_') ||
			value.startsWith('DateTime_') ||
			value.startsWith('Dateadd_') ||
			value.startsWith('DateTimeadd_') ||
			value === 'PrevMonthLastDay' ||
			value === 'NextMonthFirstDay')
	) {
		value = resolveDateFormat(value);
	}

	// Numbers
	if (typeof value === 'number') {
		if (decimals === undefined) {
			let str = String(value);
			if (str.includes('.') && /0+$/.test(str.split('.')[1])) {
				// remove trailing zeros in fractional part if decimals not specified
				str = str.replace(/\.0+$/, '');
				str = str.replace(/(\.\d*?)0+$/, '$1');
			}
			return align === 'left' ? str.padEnd(length, padChar) : str.padStart(length, padChar);
		} else {
			const dec = Number(decimals);
			const multiplier = Math.pow(10, dec);
			const rounded = Math.round(value * multiplier) / multiplier;
			let s = rounded.toFixed(dec);
			return align === 'left' ? s.padEnd(length, padChar) : s.padStart(length, padChar);
		}
	}

	// If it's string that looks like a number and decimals specified, try to format
	if (decimals !== undefined && !isNaN(Number(value))) {
		const dec = Number(decimals);
		const num = Number(value);
		const rounded = Math.round(num * Math.pow(10, dec)) / Math.pow(10, dec);
		let s = rounded.toFixed(dec);
		return align === 'left' ? s.padEnd(length, padChar) : s.padStart(length, padChar);
	}

	// Strings
	const s = String(value);
	if (align === 'left') return s.padEnd(length, padChar).substring(0, length);
	return s.padStart(length, padChar).substring(0, length);
}

// =====================
//  HESAPLAMA FONKSİYONLARI (footer)
// =====================

function calcValue(
	calcType: string,
	items: any[],
	key: string | null,
	expr?: string | null,
): number {
	// items: array of rows
	if (!Array.isArray(items)) items = [];

	if (calcType === 'count') return items.length;

	// when expr provided, compute numbers via expr per item
	const nums = items.map((row) => {
		if (expr) {
			const v = evalExpression(expr, { row, items });
			return Number(v) || 0;
		} else {
			const val = key ? getByPath(row, key) : undefined;
			return Number(val) || 0;
		}
	});

	switch (calcType) {
		case 'sum':
			return nums.reduce((a, b) => a + b, 0);
		case 'avg':
			return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0;
		case 'min':
			return nums.length ? Math.min(...nums) : 0;
		case 'max':
			return nums.length ? Math.max(...nums) : 0;
		default:
			return 0;
	}
}

// =====================
//  EXPRESSION EVALUATOR
//  - Accepts expr string and a context object:
//    For line-level: { row, items, data }
//    For header/footer-level: { data, items }
//  - Bare identifiers are resolved by nested with(): row takes precedence over data
// =====================

function evalExpression(expr: string | null, context: any = {}): any {
	if (!expr) return '';

	const safeKeys = Object.keys(exprHelpers);
	const safeVals = Object.values(exprHelpers);

	// Prepare params: data, row, items, plus helper function names
	const params = ['data', 'row', 'items', ...safeKeys];
	const args = [context.data || {}, context.row || {}, context.items || [], ...safeVals];

	try {
		// Use nested with() to allow bare identifiers to resolve to row first, then data.
		// Implementation:
		// with (data) { with (row) { return ( <expr> ); } }
		// Note: avoid 'use strict' so with is allowed.
		const wrapper = `
      with (data) {
        with (row) {
          return (${expr});
        }
      }
    `;
		const fn = new Function(...params, wrapper);
		return fn(...args);
	} catch (e) {
		// If evaluation fails, return empty string to avoid crash
		return '';
	}
}

// =====================
//  XML PARSE FONKSİYONU (DOM Parser ile)
// =====================

interface FieldSchema {
	name: string;
	fixed: string | null;
	key: string | null;
	expr?: string | null;
	length: number;
	align: string;
	padChar: string;
	decimals?: number;
	inputType?: string | null;
	outputType?: string | null;
	calc?: string | null;
	calcType?: string | null;
	filterValue?: string | null;
}

interface Schema {
	header: FieldSchema[];
	settingsMap: { groupCodeField: string | null };
	line: { arrayPath: string[]; fields: FieldSchema[]; typeKey: string | null };
	footer: FieldSchema[];
}

// Helper function to get attribute case-insensitively
function getAttributeCaseInsensitive(element: any, attrName: string): string | null {
	if (!element || !element.attributes) return null;

	// Try exact match first
	const exactAttr = element.getAttribute(attrName);
	if (exactAttr !== null && exactAttr !== undefined) return exactAttr;

	// Try case-insensitive match
	const attrs = element.attributes;
	for (let i = 0; i < attrs.length; i++) {
		const attr = attrs[i];
		if (attr.name && attr.name.toLowerCase() === attrName.toLowerCase()) {
			return attr.value || null;
		}
	}

	return null;
}

function parseXMLSchema(xmlString: string): Schema {
	const schema: Schema = {
		header: [],
		settingsMap: { groupCodeField: null },
		line: { arrayPath: [], fields: [], typeKey: null },
		footer: [],
	};

	// DOM Parser kullan
	let doc: any;
	try {
		const parser = new DOMParser();
		doc = parser.parseFromString(xmlString, 'text/xml');
	} catch (error) {
		throw new Error(
			'XML parse edilemedi: ' + (error instanceof Error ? error.message : String(error)),
		);
	}

	// Parse hatası kontrolü
	const parseError = doc.getElementsByTagName('parsererror');
	if (parseError.length > 0) {
		const errorText = parseError[0].textContent || 'Bilinmeyen hata';
		throw new Error('XML parse hatası: ' + errorText);
	}

	// SettingsMap parse (ayar bilgisi, çıktıya dahil edilmez)
	const settingsMapElements = doc.getElementsByTagName('SettingsMap');
	if (settingsMapElements.length > 0) {
		const settingsMap = settingsMapElements[0];
		const groupCodeElements = settingsMap.getElementsByTagName('GroupCode');
		if (groupCodeElements.length > 0) {
			const groupCode = groupCodeElements[0];
			const fieldAttr = getAttributeCaseInsensitive(groupCode, 'field');
			if (fieldAttr) {
				schema.settingsMap.groupCodeField = fieldAttr;
			}
		}
	}

	// Header parse (Description tag'lerini ignore et, sadece Field tag'lerini al)
	const headerElements = doc.getElementsByTagName('Header');
	if (headerElements.length > 0) {
		const header = headerElements[0];
		const fieldElements = header.getElementsByTagName('Field');
		for (let i = 0; i < fieldElements.length; i++) {
			const field = fieldElements[i];
			schema.header.push({
				name: getAttributeCaseInsensitive(field, 'name') || '',
				fixed: getAttributeCaseInsensitive(field, 'fixed') || null,
				key: getAttributeCaseInsensitive(field, 'key') || null,
				expr: getAttributeCaseInsensitive(field, 'expr') || null,
				length: parseInt(getAttributeCaseInsensitive(field, 'length') || '0', 10),
				align: getAttributeCaseInsensitive(field, 'align') || 'right',
				padChar: getAttributeCaseInsensitive(field, 'padChar') || ' ',
				decimals: getAttributeCaseInsensitive(field, 'decimals')
					? parseInt(getAttributeCaseInsensitive(field, 'decimals') || '0', 10)
					: undefined,
				inputType: getAttributeCaseInsensitive(field, 'inputType') || null,
				outputType: getAttributeCaseInsensitive(field, 'outputType') || null,
			});
		}
	}

	// Line parse (Description tag'lerini ignore et)
	const lineElements = doc.getElementsByTagName('Line');
	if (lineElements.length > 0) {
		const line = lineElements[0];
		const arrayPathStr = getAttributeCaseInsensitive(line, 'arrayPath') || '';
		schema.line.arrayPath = arrayPathStr.split('/').filter((p: string) => p);
		// typeKey attribute'unu al (tip bilgisini belirten field'ın key'i)
		const typeKeyAttr = getAttributeCaseInsensitive(line, 'typeKey');
		if (typeKeyAttr) {
			schema.line.typeKey = typeKeyAttr;
		}

		const fieldElements = line.getElementsByTagName('Field');
		for (let i = 0; i < fieldElements.length; i++) {
			const field = fieldElements[i];
			schema.line.fields.push({
				name: getAttributeCaseInsensitive(field, 'name') || '',
				fixed: getAttributeCaseInsensitive(field, 'fixed') || null,
				key: getAttributeCaseInsensitive(field, 'key') || null,
				expr: getAttributeCaseInsensitive(field, 'expr') || null,
				length: parseInt(getAttributeCaseInsensitive(field, 'length') || '0', 10),
				align: getAttributeCaseInsensitive(field, 'align') || 'right',
				padChar: getAttributeCaseInsensitive(field, 'padChar') || ' ',
				decimals: getAttributeCaseInsensitive(field, 'decimals')
					? parseInt(getAttributeCaseInsensitive(field, 'decimals') || '0', 10)
					: undefined,
				inputType: getAttributeCaseInsensitive(field, 'inputType') || null,
				outputType: getAttributeCaseInsensitive(field, 'outputType') || null,
			});
		}
	}

	// Footer parse (Description tag'lerini ignore et)
	const footerElements = doc.getElementsByTagName('Footer');
	if (footerElements.length > 0) {
		const footer = footerElements[0];
		const fieldElements = footer.getElementsByTagName('Field');
		for (let i = 0; i < fieldElements.length; i++) {
			const field = fieldElements[i];
			schema.footer.push({
				name: getAttributeCaseInsensitive(field, 'name') || '',
				fixed: getAttributeCaseInsensitive(field, 'fixed') || null,
				key: getAttributeCaseInsensitive(field, 'key') || null,
				expr: getAttributeCaseInsensitive(field, 'expr') || null,
				calc: getAttributeCaseInsensitive(field, 'calc') || null,
				calcType: getAttributeCaseInsensitive(field, 'calcType') || null,
				filterValue: getAttributeCaseInsensitive(field, 'filterValue') || null,
				length: parseInt(getAttributeCaseInsensitive(field, 'length') || '0', 10),
				align: getAttributeCaseInsensitive(field, 'align') || 'right',
				padChar: getAttributeCaseInsensitive(field, 'padChar') || ' ',
				decimals: getAttributeCaseInsensitive(field, 'decimals')
					? parseInt(getAttributeCaseInsensitive(field, 'decimals') || '0', 10)
					: undefined,
				inputType: getAttributeCaseInsensitive(field, 'inputType') || null,
				outputType: getAttributeCaseInsensitive(field, 'outputType') || null,
			});
		}
	}

	return schema;
}

export class U_CalcDomTextNode implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'U_Calc_DOM_Text_Node',
		name: 'uCalcDomTextNode',
		icon: 'file:text.svg',
		group: ['transform'],
		version: 1,
		description: 'Parse XML schema using DOM parser and convert JSON data to formatted text',
		defaults: {
			name: 'U_Calc_DOM_Text_Node',
		},
		inputs: ['main'],
		outputs: ['main'],
		properties: [
			{
				displayName: 'XML Schema',
				name: 'xmlSchema',
				type: 'string',
				default: `<Root>
  <SettingsMap>
    <GroupCode field="PurchaserCode" description="Kayıtların hangi PurchaserCode alanına göre gruplanacağını belirler." />
  </SettingsMap>
  <Header>
    <Field name="HDR" fixed="HDR" length="3" 
           description="Sabit header kayıt tipi (HDR)." />
    <Field name="Purchaser" key="PurchaserCode" length="10" align="right" padChar="0"
           description="Alıcının kodu. JSON içindeki PurchaserCode değerini sağa hizalı ve sıfır pad ile yazar." />
    <Field name="ReportDate" fixed="Date_yyyyMMdd" length="8" padChar="0"
           description="Rapor oluşturma tarihi. Sistem tarihini yyyyMMdd formatında üretir." />
    <Field name="ReportDateTime" fixed="DateTime_yyyyMMddHHmmss" length="14" padChar="0"
           description="Rapor oluşturma tarih ve saati. yyyyMMddHHmmss formatında anlık timestamp üretir." />
    <Field name="Next7Days" fixed="Dateadd_Day_7_yyyyMMdd" length="8" padChar="0"
           description="Bugünden 7 gün sonrası. (Future date hesaplama)." />
  </Header>
  <Line arrayPath="Body/QueryInvoiceResponse/QueryInvoiceResult/Value/Invoice">
    <Field name="LN" fixed="LN" length="2"
           description="Sabit satır türü (Line kaydı)."/>
    <Field name="InvoiceId" key="InvoiceId" length="10" padChar="0"
           description="Faturanın ID değeri. 10 karaktere sağdan sıfır ile pad edilir." />
    <Field name="InvoiceNumber" key="InvoiceNumber" length="12" padChar="0"
           description="Fatura numarası. 12 karaktere sağdan sıfır ile pad edilir." />
    <Field name="Currency" key="Currency" length="3" padChar=" "
           description="Para birimi. 3 karakter, boşluk pad ile." />
    <Field name="InvoiceAmount" key="InvoiceAmount" length="14" decimals="2" padChar="0"
           description="Fatura tutarı. 14 karakter genişlikte ve 2 ondalık olacak şekilde sıfır ile pad edilir." />
    <Field name="PaymentAmount" key="PaymentAmount" length="14" decimals="2" padChar="0"
           description="Ödenen tutar. 14 karakter ve 2 ondalıklı format." />
    <Field name="InvoiceDate" key="InvoiceDate" inputType="yyyy-MM-dd" outputType="ddMMyyyy" length="8" padChar="0"
           description="Fatura tarihi. yyyy-MM-dd formatından ddMMyyyy formatına çevrilir." />
    <Field name="LastAttempt" key="LastCollectionAttemptDate" inputType="yyyy-MM-dd" outputType="ddMMyyyy" length="8" padChar="0"
           description="Son tahsilat deneme tarihi. Format dönüşümü yapılır." />
    <Field name="Remaining" expr="InvoiceAmount - PaymentAmount" length="14" decimals="2" padChar="0"
           description="Kalan tutar. Matematiksel ifade: InvoiceAmount - PaymentAmount." />
    <Field name="HighFlag" expr="InvoiceAmount > 10000 ? 1 : 0" length="1" padChar="0"
           description="10.000 üzeri faturalara işaretleme yapan flag (1=yüksek tutar, 0=normal)." />
  </Line>
  <Footer>
    <Field name="FTR" fixed="FTR" length="3"
           description="Footer kayıt tipi (FTR)." />
    <Field name="LineCount" calc="calc" calcType="count" length="8" padChar="0"
           description="Toplam satır sayısı (Invoice satırı adedi)." />
    <Field name="TotalInvoice" key="InvoiceAmount" calc="calc" calcType="sum" decimals="2" length="16" padChar="0"
           description="Tüm faturaların toplam InvoiceAmount değeri." />
    <Field name="TotalPayment" key="PaymentAmount" calc="calc" calcType="sum" decimals="2" length="16" padChar="0"
           description="Tüm satırlardaki PaymentAmount toplamı." />
    <Field name="MinInvoice" key="InvoiceAmount" calc="calc" calcType="min" decimals="2" length="16" padChar="0"
           description="En düşük fatura tutarı (InvoiceAmount min değeri)." />
    <Field name="MaxInvoice" key="InvoiceAmount" calc="calc" calcType="max" decimals="2" length="16" padChar="0"
           description="En yüksek fatura tutarı (InvoiceAmount max değeri)." />
    <Field name="AvgInvoice" key="InvoiceAmount" calc="calc" calcType="avg" decimals="2" length="16" padChar="0"
           description="Fatura tutarlarının ortalaması (avg)." />
  </Footer>
</Root>`,
				noDataExpression: false,
				description:
					'XML schema string that defines Header, Line, and Footer fields. Supports expressions and fixed values.',
				placeholder: '<FileSchema>...</FileSchema>',
			},
			{
				displayName: 'Input Data JSON',
				name: 'inputDataJson',
				type: 'string',
				default: '={{ $json.parsedData }}',
				noDataExpression: false,
				description:
					'JSON data object that contains the data to be processed. Supports expressions.',
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
			try {
				// Parameter'lardan XML Schema ve Input Data JSON'ı al
				const xmlSchema = this.getNodeParameter('xmlSchema', itemIndex) as string;
				let parsedData = this.getNodeParameter('inputDataJson', itemIndex) as any;

				if (!xmlSchema) {
					throw new NodeOperationError(
						this.getNode(),
						"XML schema bulunamadı. 'XML Schema' field'ını doldurun.",
						{ itemIndex },
					);
				}

				// Input Data JSON string ise parse et
				if (typeof parsedData === 'string') {
					try {
						parsedData = JSON.parse(parsedData);
					} catch (e) {
						throw new NodeOperationError(
							this.getNode(),
							'Input Data JSON parse edilemedi: ' + (e instanceof Error ? e.message : String(e)),
							{ itemIndex },
						);
					}
				}

				if (!parsedData || typeof parsedData !== 'object') {
					throw new NodeOperationError(
						this.getNode(),
						"Input Data JSON bulunamadı veya geçersiz. 'Input Data JSON' field'ını kontrol edin.",
						{ itemIndex },
					);
				}

				// XML şemayı parse et
				const schema = parseXMLSchema(xmlSchema);

				// Line items'ı bul
				let lineItems: any = parsedData;
				for (const p of schema.line.arrayPath) {
					lineItems = (lineItems as any)?.[p];
					if (!lineItems) {
						lineItems = [];
						break;
					}
				}

				if (!Array.isArray(lineItems)) {
					lineItems = [];
				}

				// =====================
				//  TXT ÜRETİM
				// =====================

				const txtLines: string[] = [];

				// ---- Header ----
				schema.header.forEach((f) => {
					let val = '';

					if (f.fixed) {
						val = f.fixed;
						// support date macros in fixed
						val = resolveDateFormat(val);
					} else if (f.expr) {
						val = evalExpression(f.expr, { data: parsedData, items: lineItems });
					} else if (f.key) {
						// key may be a path
						val = getByPath(parsedData, f.key) ?? '';
					}

					// DİNAMİK TARİH DÖNÜŞÜMÜ
					if (f.inputType && f.outputType) {
						val = convertDateUniversal(val, f.inputType, f.outputType);
					}

					txtLines.push(pad(val, f.length, f.align, f.padChar, f.decimals));
				});
				txtLines.push('\n');

				// ---- Lines ----
				// Tek satır durumunu da işle
				if (lineItems.length > 0) {
					(lineItems as any[]).forEach((li: any) => {
						schema.line.fields.forEach((f) => {
							let val = '';

							if (f.fixed) {
								val = f.fixed;
								val = resolveDateFormat(val);
							} else if (f.expr) {
								// allow expr to use bare identifiers (resolved to row then data) AND row/items/data explicitly
								val = evalExpression(f.expr, { row: li, items: lineItems, data: parsedData });
							} else if (f.key) {
								// support path keys
								val = getByPath(li, f.key);
								// if not found in row, try data as fallback
								if ((val === undefined || val === null) && parsedData)
									val = getByPath(parsedData, f.key);
							}

							// if inputType/outputType provided, use convertDateUniversal for string dates
							if (f.inputType && f.outputType && val) {
								val = convertDateUniversal(val, f.inputType, f.outputType);
							}

							// decimals formatting applied if decimals provided and value numeric-like
							if (f.decimals !== undefined && val !== '') {
								const n = Number(val);
								if (!Number.isNaN(n)) {
									val = String(Number(n.toFixed(f.decimals)));
								}
							}

							txtLines.push(pad(val, f.length, f.align, f.padChar, f.decimals));
						});
						txtLines.push('\n');
					});
				}

				// ---- Footer ----
				// Determine tipKey if needed for grouping/filtering
				let tipKey: string | null = null;
				if (schema.settingsMap.groupCodeField) {
					tipKey = schema.settingsMap.groupCodeField;
				} else if (schema.line.typeKey) {
					tipKey = schema.line.typeKey;
				} else {
					// heuristic
					const possible = schema.line.fields.find(
						(f) =>
							f.key &&
							(f.name.toLowerCase().includes('type') ||
								f.key.toLowerCase().includes('type') ||
								f.name.toLowerCase().includes('tip') ||
								f.key.toLowerCase().includes('tip')),
					);
					if (possible) tipKey = possible.key;
					else if (lineItems.length > 0) {
						// try to find a promising key in first item
						const first = lineItems[0];
						for (const k in first) {
							if (/type|tip|recordtype|kayit/i.test(k)) {
								tipKey = k;
								break;
							}
						}
					}
				}

				let lastFilterValue: string | null = null;
				for (let i = 0; i < schema.footer.length; i++) {
					const f = schema.footer[i];
					// check whether we need to inject a type header when calcType=Group + filterValue changes
					let currentFilterValue: string | null = null;
					if (f.calcType === 'Group' && f.filterValue) currentFilterValue = f.filterValue;
					else if (f.calcType && f.calcType !== 'Group') currentFilterValue = null; // no auto injection in this path

					// If f.fixed matches next field's filterValue, skip (compat logic from earlier)
					if (f.fixed && i < schema.footer.length - 1) {
						const next = schema.footer[i + 1];
						const nextFilter =
							next && next.calcType === 'Group' && next.filterValue ? next.filterValue : null;
						if (nextFilter && String(f.fixed) === String(nextFilter)) {
							continue;
						}
					}

					// If currentFilterValue and changed, inject a type line (value = currentFilterValue) using tipField props
					if (currentFilterValue && currentFilterValue !== lastFilterValue) {
						// find tip field details
						const tipField =
							schema.line.fields.find((ff) => ff.key === tipKey) ||
							schema.line.fields.find(
								(ff) =>
									ff.name.toLowerCase().includes('type') || ff.name.toLowerCase().includes('tip'),
							);
						const tlen = tipField ? tipField.length : 1;
						const talign = tipField ? tipField.align : 'left';
						const tpad = tipField ? tipField.padChar : ' ';
						txtLines.push(pad(currentFilterValue, tlen, talign, tpad));
						lastFilterValue = currentFilterValue;
					}

					let val = '';

					if (f.fixed) {
						val = f.fixed;
						val = resolveDateFormat(val);
					} else if (f.expr) {
						// header/footer level expr: context has data & items
						val = evalExpression(f.expr, { data: parsedData, items: lineItems });
					} else if (f.calc) {
						// handle calc: filter by filterValue if present
						let itemsToCalc: any[] = lineItems;

						// compute filterValue: support path (contains '/') or expression starting '='
						let resolvedFilterValue = currentFilterValue;
						if (resolvedFilterValue && typeof resolvedFilterValue === 'string') {
							if (resolvedFilterValue.includes('/')) {
								resolvedFilterValue = getByPath(parsedData, resolvedFilterValue);
							} else if (resolvedFilterValue.startsWith('=')) {
								// treat as expr: "=data.SomeField" or "=row.Type"
								resolvedFilterValue = evalExpression(resolvedFilterValue.substring(1), {
									data: parsedData,
									items: lineItems,
								});
							}
						}

						if (resolvedFilterValue != null && tipKey) {
							itemsToCalc = lineItems.filter((it: any) => {
								const v = getByPath(it, tipKey);
								return String(v) === String(resolvedFilterValue);
							});
						}

						// support sumExpr: f.calcType === 'sumExpr' and f.expr defined -> sum of expr per line
						if (f.calcType === 'sumExpr' && f.expr) {
							const sum = calcValue('sum', itemsToCalc, null, f.expr);
							val =
								f.decimals !== undefined ? String(Number(sum.toFixed(f.decimals))) : String(sum);
						} else {
							const calcRes = calcValue(f.calcType || '', itemsToCalc, f.key, f.expr || undefined);
							val =
								f.decimals !== undefined && typeof calcRes === 'number'
									? String(Number(calcRes.toFixed(f.decimals)))
									: String(calcRes);
						}
					} else if (f.key) {
						// try parsedData key first (footer-level keys often in header), otherwise fallback to root
						val = getByPath(parsedData, f.key) ?? '';
					}

					// DİNAMİK TARİH DÖNÜŞÜMÜ
					if (f.inputType && f.outputType) {
						val = String(convertDateUniversal(val, f.inputType, f.outputType));
					}

					txtLines.push(pad(val, f.length, f.align, f.padChar, f.decimals));
				}

				// =====================
				//  SONUÇ
				// =====================

				returnData.push({
					json: {
						txt: txtLines.join(''),
					},
					pairedItem: {
						item: itemIndex,
					},
				});
			} catch (error) {
				if (this.continueOnFail()) {
					returnData.push({
						json: {
							error: error instanceof Error ? error.message : String(error),
						},
						pairedItem: {
							item: itemIndex,
						},
					});
					continue;
				}
				throw error;
			}
		}

		return [returnData];
	}
}
