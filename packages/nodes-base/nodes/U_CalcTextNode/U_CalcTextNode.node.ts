import { DOMParser } from '@xmldom/xmldom';
import {
	type IExecuteFunctions,
	type INodeExecutionData,
	type INodeType,
	type INodeTypeDescription,
	NodeOperationError,
} from 'n8n-workflow';

// =====================
//  FULL FEATURED TRANSFORMER (NATIVE — mirrors U_CalcDomTextNode)
//  - Date/DateTime/Dateadd support
//  - pad/align/decimals
//  - expr evaluation (bare identifiers resolve to row then data)
//  - footer calc: count,sum,min,max,avg,sumExpr
//  - filterValue/grouping support
//  - XML schema parser (DOM-based) with description ignore
//  - Runs in the main n8n process (no task-runner sandbox), same as U_CalcDomTextNode
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
	const parts = String(path)
		.replace(/\./g, '/')
		.split('/')
		.filter((p) => p !== '');
	let cur = obj;
	for (const p of parts) {
		if (cur == null) return undefined;
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

	let regexStr = inputFmt;
	Object.keys(parts).forEach((k) => {
		regexStr = regexStr.replace(k, parts[k].regex);
	});

	const regex = new RegExp('^' + regexStr + '$');
	const match = String(value).match(regex);

	if (!match) return value;

	const extracted: any = {};
	let idx = 1;

	Object.keys(parts).forEach((k) => {
		if (inputFmt.includes(k)) {
			parts[k].setter(extracted, match[idx++]);
		}
	});

	let yyyy = extracted.yyyy;
	if (!yyyy && extracted.yy) {
		const num = Number(extracted.yy);
		yyyy = num >= 70 ? 1900 + num : 2000 + num;
	}

	const MM = extracted.MM ? Number(extracted.MM) : 1;
	const dd = extracted.dd ? Number(extracted.dd) : 1;

	const dt = new Date(yyyy, MM - 1, dd);

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

	if (str.startsWith('Date_')) {
		const fmt = str.replace('Date_', '');
		return formatDateFull(new Date(), fmt);
	}

	if (str.startsWith('DateTime_')) {
		const fmt = str.replace('DateTime_', '');
		return formatDateFull(new Date(), fmt);
	}

	if (str.startsWith('Dateadd_')) {
		const parts = str.split('_');
		const unit = parts[1];
		const amount = parseInt(parts[2], 10);
		const fmt = parts.slice(3).join('_');
		const dt = new Date();
		if (unit === 'Day') dt.setDate(dt.getDate() + amount);
		else if (unit === 'Month') dt.setMonth(dt.getMonth() + amount);
		else if (unit === 'Year') dt.setFullYear(dt.getFullYear() + amount);
		return formatDateFull(dt, fmt);
	}

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

	if (str === 'PrevMonthLastDay') {
		const now = new Date();
		const dt = new Date(now.getFullYear(), now.getMonth(), 0);
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

	if (typeof value === 'number') {
		if (decimals === undefined) {
			let str = String(value);
			if (str.includes('.') && /0+$/.test(str.split('.')[1])) {
				str = str.replace(/\.0+$/, '');
				str = str.replace(/(\.\d*?)0+$/, '$1');
			}
			return align === 'left' ? str.padEnd(length, padChar) : str.padStart(length, padChar);
		} else {
			const dec = Number(decimals);
			const multiplier = Math.pow(10, dec);
			const rounded = Math.round(value * multiplier) / multiplier;
			const s = rounded.toFixed(dec);
			return align === 'left' ? s.padEnd(length, padChar) : s.padStart(length, padChar);
		}
	}

	if (decimals !== undefined && !isNaN(Number(value))) {
		const dec = Number(decimals);
		const num = Number(value);
		const rounded = Math.round(num * Math.pow(10, dec)) / Math.pow(10, dec);
		const s = rounded.toFixed(dec);
		return align === 'left' ? s.padEnd(length, padChar) : s.padStart(length, padChar);
	}

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
	if (!Array.isArray(items)) items = [];

	if (calcType === 'count') return items.length;

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

	const params = ['data', 'row', 'items', ...safeKeys];
	const args = [context.data || {}, context.row || {}, context.items || [], ...safeVals];

	try {
		const wrapper = `
      with (data) {
        with (row) {
          return (${expr});
        }
      }
    `;
		// eslint-disable-next-line @typescript-eslint/no-implied-eval
		const fn = new Function(...params, wrapper);
		return fn(...args);
	} catch (e) {
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

function getAttributeCaseInsensitive(element: any, attrName: string): string | null {
	if (!element || !element.attributes) return null;

	const exactAttr = element.getAttribute(attrName);
	if (exactAttr !== null && exactAttr !== undefined) return exactAttr;

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

	let doc: any;
	try {
		const parser = new DOMParser();
		doc = parser.parseFromString(xmlString, 'text/xml');
	} catch (error) {
		throw new Error(
			'XML parse edilemedi: ' + (error instanceof Error ? error.message : String(error)),
		);
	}

	const parseError = doc.getElementsByTagName('parsererror');
	if (parseError.length > 0) {
		const errorText = parseError[0].textContent || 'Bilinmeyen hata';
		throw new Error('XML parse hatası: ' + errorText);
	}

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

	const lineElements = doc.getElementsByTagName('Line');
	if (lineElements.length > 0) {
		const line = lineElements[0];
		const arrayPathStr = getAttributeCaseInsensitive(line, 'arrayPath') || '';
		schema.line.arrayPath = arrayPathStr.split('/').filter((p: string) => p);
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

export class U_CalcTextNode implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'U_Calc_Text_Node',
		name: 'uCalcTextNode',
		icon: 'file:text.svg',
		group: ['transform'],
		version: 1,
		description:
			'Render fixed-width text from JSON data using an XML schema. Native execution, no sandbox.',
		defaults: {
			name: 'U_Calc_Text_Node',
		},
		inputs: ['main'],
		outputs: ['main'],
		properties: [
			{
				displayName: 'XML Schema',
				name: 'xmlSchema',
				type: 'string',
				default: `<?xml version="1.0" encoding="UTF-8"?>
<Root>

  <!-- SettingsMap: Gruplama ayarları (opsiyonel) -->
  <SettingsMap>
    <GroupCode field="FirmaKodu" description="Kayıtların FirmaKodu alanına göre gruplanması." />
  </SettingsMap>

  <!-- BAŞLIK KAYDI (Header Record)
       Header field'ları üst-level key'lere (satırların DIŞINDA duran meta alanlara)
       örn. FirmaKodu, veya 'fixed' macro'larla sistem tarihi/saati üretmek için kullanılır. -->
  <Header>
    <Field name="KayitTipi" fixed="H" length="1" align="left" padChar=" "
           description="Kayıt tipi (1 karakter, 'H' sabit değer)." />
    <Field name="FirmaKodu" key="FirmaKodu" length="10" align="left" padChar=" "
           description="Firma kodu (üst-level meta alanı)." />
    <Field name="DosyaTarihi" fixed="Date_ddMMyyyy" length="8" align="right" padChar="0"
           description="Dosya tarihi (ddMMyyyy)." />
    <Field name="DosyaZamani" fixed="DateTime_HHmmss" length="6" align="right" padChar="0"
           description="Dosya zamanı (HHmmss)." />
    <Field name="ToplamKayitSayisi" expr="items.length" length="7" align="right" padChar="0"
           description="Toplam kayıt sayısı (expression ile hesaplanır)." />
  </Header>

  <!-- DETAY KAYDI (Detail Record)
       arrayPath: parsedData içindeki satır array'inin konumu (slash veya nokta ile ayrılır).
       Örneğin input = { data: [ {...}, {...} ], FirmaKodu: "PKBOYA" } ise arrayPath="data" olur.
       Eğer arrayPath boş bırakılır veya yanlış girilirse, node parsedData içinde
       tek bir array property varsa onu otomatik bulur. -->
  <Line arrayPath="data">
    <Field name="KayitTipi" fixed="D" length="1" align="left" padChar=" "
           description="Kayıt tipi (1 karakter, 'D' sabit değer)." />
    <Field name="InvoiceNumber" key="InvoiceNumber" length="14" align="right" padChar="0"
           description="Fatura numarası." />
    <Field name="PurchaserCode" key="PurchaserCode" length="10" align="right" padChar="0"
           description="Alıcı kodu." />
    <Field name="SupplierCode" key="SupplierCode" length="10" align="right" padChar="0"
           description="Tedarikçi kodu." />
    <Field name="Currency" key="Currency" length="3" align="left" padChar=" "
           description="Para birimi (3 karakter)." />
    <Field name="InvoiceAmount" key="InvoiceAmount" length="15" decimals="2" align="right" padChar="0"
           description="Fatura tutarı (15 karakter, 2 ondalık)." />
    <Field name="InvoiceDate" key="InvoiceDate" length="8" align="right" padChar="0"
           description="Fatura tarihi (yyyyMMdd formatında geldiği varsayılır)." />
    <Field name="InvoiceDueDate" key="InvoiceDueDate" length="8" align="right" padChar="0"
           description="Fatura vade tarihi." />
    <Field name="PurchaserName" key="PurchaserName" length="40" align="left" padChar=" "
           description="Alıcı adı." />
  </Line>

  <!-- TOPLAM KAYDI (Footer Record) -->
  <Footer>
    <Field name="KayitTipi" fixed="F" length="1" align="left" padChar=" "
           description="Kayıt tipi (1 karakter, 'F' sabit değer)." />
    <Field name="KayitSayisi" calc="calc" calcType="count" length="7" align="right" padChar="0"
           description="Detay kayıt sayısı (count)." />
    <Field name="ToplamFaturaTutari" key="InvoiceAmount" calc="calc" calcType="sum" length="15" decimals="2" align="right" padChar="0"
           description="Toplam fatura tutarı (sum)." />
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
					'JSON data object or array to process. Supports n8n expressions. Pass the full item object to keep access to top-level meta fields alongside the line array.',
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

				// =====================
				//  LINE ITEMS RESOLUTION
				//  Öncelik sırası:
				//   1) schema.line.arrayPath'i yürüt — array döndürürse kullan, tek obje dönerse [obj] olarak sar
				//   2) parsedData zaten bir array ise onu kullan
				//   3) parsedData obje ise içindeki ilk array-tipli property'yi otomatik bul
				//   4) Hiçbiri yoksa boş
				//
				//  Header/footer key lookup'ları her zaman ORİJİNAL parsedData üzerinden yapılır,
				//  böylece satırlarla aynı seviyede duran meta alanları (örn. FirmaKodu) erişilebilir kalır.
				// =====================
				const parsedDataRoot: any = parsedData;

				let lineItems: any = null;

				if (schema.line.arrayPath.length > 0) {
					let cur: any = parsedDataRoot;
					for (const p of schema.line.arrayPath) {
						if (cur == null) break;
						cur = cur[p];
					}
					if (Array.isArray(cur)) {
						lineItems = cur;
					} else if (cur != null && typeof cur === 'object') {
						lineItems = [cur];
					}
				}

				if (lineItems == null && Array.isArray(parsedDataRoot)) {
					lineItems = parsedDataRoot;
				}

				if (lineItems == null && parsedDataRoot && typeof parsedDataRoot === 'object') {
					const arrayProps = Object.keys(parsedDataRoot).filter((k) =>
						Array.isArray((parsedDataRoot as any)[k]),
					);
					if (arrayProps.length === 1) {
						lineItems = (parsedDataRoot as any)[arrayProps[0]];
					}
				}

				if (!Array.isArray(lineItems)) {
					lineItems = [];
				}

				// scopeForKeys: header/footer key çözümü için her zaman kök obje
				// (array case'de ilk satıra fallback — meta alanı satır içindeyse bulunsun diye)
				const scopeForKeys: any = Array.isArray(parsedDataRoot)
					? lineItems[0] || {}
					: parsedDataRoot;

				// =====================
				//  TXT ÜRETİM
				// =====================

				const txtLines: string[] = [];

				// ---- Header ----
				schema.header.forEach((f) => {
					let val: any = '';

					if (f.fixed) {
						val = f.fixed;
						val = resolveDateFormat(val);
					} else if (f.expr) {
						val = evalExpression(f.expr, { data: parsedData, items: lineItems });
					} else if (f.key) {
						val = getByPath(scopeForKeys, f.key);
						if (val == null) val = getByPath(parsedData, f.key);
						if (val == null) val = '';
					}

					if (f.inputType && f.outputType && val) {
						val = convertDateUniversal(String(val), f.inputType, f.outputType);
					}

					txtLines.push(pad(val, f.length, f.align, f.padChar, f.decimals));
				});
				txtLines.push('\n');

				// ---- Lines ----
				if (lineItems.length > 0) {
					(lineItems as any[]).forEach((li: any) => {
						// Pre-process: Calculate expr fields and add to row for filterValue support
						schema.line.fields.forEach((f) => {
							if (f.expr && f.key) {
								const val = evalExpression(f.expr, {
									row: li,
									items: lineItems,
									data: parsedData,
								});
								if (val !== undefined && val !== null) {
									li[f.key] = val;
								}
							}
						});

						schema.line.fields.forEach((f) => {
							let val: any = '';

							if (f.fixed) {
								val = f.fixed;
								val = resolveDateFormat(val);
							} else if (f.expr) {
								val = evalExpression(f.expr, {
									row: li,
									items: lineItems,
									data: parsedData,
								});
								if (val === undefined || val === null) val = '';
							} else if (f.key) {
								val = getByPath(li, f.key);
								if ((val === undefined || val === null) && parsedData)
									val = getByPath(parsedData, f.key);
							}

							if (f.inputType && f.outputType && val) {
								val = convertDateUniversal(String(val), f.inputType, f.outputType);
							}

							if (f.decimals !== undefined && val !== '') {
								const n = Number(val);
								if (!Number.isNaN(n)) {
									const multiplier = Math.pow(10, f.decimals);
									val = Math.round(n * multiplier) / multiplier;
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
					let currentFilterValue: string | null = null;
					if (f.calcType === 'Group' && f.filterValue) currentFilterValue = f.filterValue;
					else if (f.calcType && f.calcType !== 'Group') currentFilterValue = null;

					if (f.fixed && i < schema.footer.length - 1) {
						const next = schema.footer[i + 1];
						const nextFilter =
							next && next.calcType === 'Group' && next.filterValue ? next.filterValue : null;
						if (nextFilter && String(f.fixed) === String(nextFilter)) {
							continue;
						}
					}

					if (currentFilterValue && currentFilterValue !== lastFilterValue) {
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

					let val: any = '';

					if (f.fixed) {
						val = f.fixed;
						val = resolveDateFormat(val);
					} else if (f.expr) {
						val = evalExpression(f.expr, { data: parsedData, items: lineItems });
					} else if (f.calc) {
						let itemsToCalc: any[] = lineItems;

						let resolvedFilterValue: any = currentFilterValue;
						if (resolvedFilterValue && typeof resolvedFilterValue === 'string') {
							if (resolvedFilterValue.includes('/')) {
								resolvedFilterValue = getByPath(parsedData, resolvedFilterValue);
							} else if (resolvedFilterValue.startsWith('=')) {
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
						val = getByPath(scopeForKeys, f.key);
						if (val == null) val = getByPath(parsedData, f.key);
						if (val == null) val = '';
					}

					if (f.inputType && f.outputType && val) {
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
