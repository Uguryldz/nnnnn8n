// Test kodu - Node kodundan alınmıştır
// input.json ve template_example.xml dosyalarını kullanarak test yapar

const fs = require('fs');
const path = require('path');

// Dosyaları oku
const inputData = JSON.parse(fs.readFileSync(path.join(__dirname, 'invinput.json'), 'utf8'));
const xmlSchema = fs.readFileSync(
	path.join(__dirname, 'faturatemplate', 'template_tahsilat.xml'),
	'utf8',
);

// =====================
//  FULL FEATURED TRANSFORMER (FINAL)
//  - Date/DateTime/Dateadd support
//  - pad/align/decimals
//  - expr evaluation (bare identifiers resolve to row then data)
//  - footer calc: count,sum,min,max,avg,sumExpr
//  - filterValue/grouping support
//  - XML schema parser (regex-based) with description ignore
// =====================

// ---------------------
//  UTIL: safe helpers for expressions
// ---------------------
const exprHelpers = {
	round: (v, d = 0) => {
		const m = Math.pow(10, d);
		return Math.round(v * m) / m;
	},
	floor: (v) => Math.floor(v),
	ceil: (v) => Math.ceil(v),
	abs: (v) => Math.abs(v),
	min: (...a) => Math.min(...a),
	max: (...a) => Math.max(...a),
	sum: (arr) => (Array.isArray(arr) ? arr.reduce((s, x) => s + (Number(x) || 0), 0) : 0),
	avg: (arr) =>
		Array.isArray(arr) && arr.length
			? arr.reduce((s, x) => s + (Number(x) || 0), 0) / arr.length
			: 0,
	Number: (v) => Number(v),
	parseFloat: (v) => parseFloat(v),
};

// ---------------------
//  PATH / GETTER
// ---------------------
function getByPath(obj, path) {
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

// ---------------------
//  DATE CONVERTERS
// ---------------------
function convertDateUniversal(value, inputFmt, outputFmt) {
	if (!value || !inputFmt || !outputFmt) return value;

	const parts = {
		yyyy: { regex: '(\\d{4})', setter: (o, v) => (o.yyyy = v) },
		yy: { regex: '(\\d{2})', setter: (o, v) => (o.yy = v) },
		MM: { regex: '(\\d{2})', setter: (o, v) => (o.MM = v) },
		dd: { regex: '(\\d{2})', setter: (o, v) => (o.dd = v) },
	};

	let regexStr = inputFmt;
	Object.keys(parts).forEach((k) => {
		regexStr = regexStr.replace(k, parts[k].regex);
	});

	const regex = new RegExp('^' + regexStr + '$');
	const match = String(value).match(regex);

	if (!match) return value;

	let extracted = {};
	let idx = 1;

	// Sadece inputFmt'te olan key'leri işle (sırayla)
	// Önce yyyy kontrolü yap, sonra yy kontrolü yap (yy yyyy içinde olduğu için)
	const keysInOrder = ['yyyy', 'yy', 'MM', 'dd'];
	keysInOrder.forEach((k) => {
		// yy kontrolü: sadece yyyy yoksa ve yy varsa
		if (k === 'yy') {
			if (!inputFmt.includes('yyyy') && inputFmt.includes('yy')) {
				parts[k].setter(extracted, match[idx++]);
			}
		} else if (inputFmt.includes(k)) {
			parts[k].setter(extracted, match[idx++]);
		}
	});

	let yyyy = extracted.yyyy ? Number(extracted.yyyy) : null;
	if (!yyyy && extracted.yy) {
		const num = Number(extracted.yy);
		yyyy = num >= 70 ? 1900 + num : 2000 + num;
	}

	const MM = extracted.MM ? Number(extracted.MM) : 1;
	const dd = extracted.dd ? Number(extracted.dd) : 1;

	// Tarih validasyonu: geçerli tarih kontrolü
	if (MM < 1 || MM > 12 || dd < 1 || dd > 31) {
		return value; // Geçersiz tarih, orijinal değeri döndür
	}

	const dt = new Date(yyyy, MM - 1, dd);

	// Tarih validasyonu: oluşturulan tarih ile input tarih uyumlu mu?
	if (dt.getFullYear() !== yyyy || dt.getMonth() !== MM - 1 || dt.getDate() !== dd) {
		return value; // Geçersiz tarih (örn: 31 Şubat), orijinal değeri döndür
	}

	let out = outputFmt;

	out = out.replace('yyyy', dt.getFullYear());
	out = out.replace('yy', String(dt.getFullYear()).slice(-2));
	out = out.replace('MM', String(dt.getMonth() + 1).padStart(2, '0'));
	out = out.replace('dd', String(dt.getDate()).padStart(2, '0'));

	return out;
}

function formatDateFull(dt, fmt) {
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
		.replace('yyyy', yyyy)
		.replace('yy', yy)
		.replace('HH', HH)
		.replace('mm', mm)
		.replace('ss', ss);
}

function resolveDateFormat(str) {
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
		if (parts.length < 4) return str; // Hata kontrolü: yeterli parametre yok
		const unit = parts[1];
		const amount = parseInt(parts[2], 10);
		if (isNaN(amount)) return str; // Hata kontrolü: amount geçersiz
		const fmt = parts.slice(3).join('_');
		if (!fmt) return str; // Hata kontrolü: format yok
		const dt = new Date();
		if (unit === 'Day') dt.setDate(dt.getDate() + amount);
		else if (unit === 'Month') dt.setMonth(dt.getMonth() + amount);
		else if (unit === 'Year') dt.setFullYear(dt.getFullYear() + amount);
		else return str; // Hata kontrolü: geçersiz unit
		return formatDateFull(dt, fmt);
	}

	// DateTimeadd_Unit_Amount_Format (e.g. DateTimeadd_Hour_1_yyyyMMddHHmmss)
	if (str.startsWith('DateTimeadd_')) {
		const parts = str.split('_');
		if (parts.length < 4) return str; // Hata kontrolü: yeterli parametre yok
		const unit = parts[1];
		const amount = parseInt(parts[2], 10);
		if (isNaN(amount)) return str; // Hata kontrolü: amount geçersiz
		const fmt = parts.slice(3).join('_');
		if (!fmt) return str; // Hata kontrolü: format yok
		const dt = new Date();
		if (unit === 'Hour') dt.setHours(dt.getHours() + amount);
		else if (unit === 'Minute') dt.setMinutes(dt.getMinutes() + amount);
		else if (unit === 'Second') dt.setSeconds(dt.getSeconds() + amount);
		else if (unit === 'Day') dt.setDate(dt.getDate() + amount);
		else if (unit === 'Month') dt.setMonth(dt.getMonth() + amount);
		else if (unit === 'Year') dt.setFullYear(dt.getFullYear() + amount);
		else return str; // Hata kontrolü: geçersiz unit
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

// ---------------------
//  PADDING & FORMAT
// ---------------------
function pad(value, length, align = 'right', padChar = ' ', decimals) {
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
		// Math.round kullanarak precision sorununu çöz (toFixed yerine)
		const multiplier = Math.pow(10, dec);
		const rounded = Math.round(num * multiplier) / multiplier;
		// toFixed kullan ama önce Math.round ile düzelt
		let s = rounded.toFixed(dec);
		return align === 'left' ? s.padEnd(length, padChar) : s.padStart(length, padChar);
	}

	// Strings
	const s = String(value);
	if (align === 'left') return s.padEnd(length, padChar).substring(0, length);
	return s.padStart(length, padChar).substring(0, length);
}

// ---------------------
//  CALC FUNCTIONS (footer)
// ---------------------
function calcValue(calcType, items, key, expr) {
	// items: array of rows
	if (!Array.isArray(items)) items = [];

	if (calcType === 'count') return items.length;

	// when expr provided, compute numbers via expr per item
	const nums = items.map((row) => {
		if (expr) {
			const v = evalExpression(expr, { row, items });
			const num = Number(v);
			// NaN kontrolü: NaN ise 0 döndür ama hata logla
			if (Number.isNaN(num)) {
				if (typeof console !== 'undefined' && console.warn) {
					console.warn('calcValue: NaN detected in expression result, using 0');
				}
				return 0;
			}
			return num;
		} else {
			const val = key ? getByPath(row, key) : undefined;
			const num = Number(val);
			// NaN kontrolü
			if (Number.isNaN(num)) {
				return 0;
			}
			return num;
		}
	});

	switch (calcType) {
		case 'sum':
			return nums.reduce((a, b) => a + b, 0);
		case 'avg':
			return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0;
		case 'min':
			if (!nums.length) return null; // Boş array için null döndür (0 yerine)
			return Math.min(...nums);
		case 'max':
			if (!nums.length) return null; // Boş array için null döndür (0 yerine)
			return Math.max(...nums);
		default:
			return 0;
	}
}

// ---------------------
//  EXPRESSION EVALUATOR
//  - Accepts expr string and a context object:
//    For line-level: { row, items, data }
//    For header/footer-level: { data, items }
//  - Bare identifiers are resolved by nested with(): row takes precedence over data
// ---------------------
function evalExpression(expr, context = {}) {
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
		// Log error for debugging (only in development)
		if (typeof console !== 'undefined' && console.error) {
			console.error('Expression evaluation error:', expr, e.message);
		}
		return '';
	}
}

// ---------------------
//  XML SCHEMA PARSER (regex-based)
//  - Supports description tags (ignored), supports attributes:
//    name,fixed,key,expr,length,align,padChar,decimals,inputType,outputType,calc,calcType,filterValue
// ---------------------
function getAttribute(match, attrName) {
	const regex = new RegExp(attrName + '="([^"]*)"', 'i');
	const result = regex.exec(match);
	return result ? result[1] : null;
}

function parseXMLSchema(xmlString) {
	const schema = {
		header: [],
		settingsMap: { groupCodeField: null },
		line: { arrayPath: [], fields: [], typeKey: null },
		footer: [],
	};

	// SettingsMap
	const settingsMapMatch = xmlString.match(
		new RegExp('<SettingsMap[^>]*>([\\s\\S]*?)</SettingsMap>', 'i'),
	);
	if (settingsMapMatch) {
		const groupCodeMatch = settingsMapMatch[1].match(
			new RegExp('<GroupCode[^>]*field="([^"]*)"', 'i'),
		);
		if (groupCodeMatch) schema.settingsMap.groupCodeField = groupCodeMatch[1];
	}

	// Header
	const headerMatch = xmlString.match(new RegExp('<Header[^>]*>([\\s\\S]*?)</Header>', 'i'));
	if (headerMatch) {
		// Fix: Use [\s\S]*? to match multiline Field tags
		const fieldMatches =
			headerMatch[1].match(
				new RegExp('<Field[\\s\\S]*?/>|<Field[^>]*>([\\s\\S]*?)</Field>', 'gi'),
			) || [];
		fieldMatches.forEach((fieldMatch) => {
			// Fix: Match multiline Field tags with [\s\S]*?
			const openTagMatch =
				fieldMatch.match(new RegExp('<Field[\\s\\S]*?/>', 'i')) ||
				fieldMatch.match(new RegExp('<Field[^>]*>', 'i'));
			if (!openTagMatch) return;
			const fieldTag = openTagMatch[0];
			schema.header.push({
				name: getAttribute(fieldTag, 'name') || '',
				fixed: getAttribute(fieldTag, 'fixed') || null,
				key: getAttribute(fieldTag, 'key') || null,
				expr: getAttribute(fieldTag, 'expr') || null,
				length: parseInt(getAttribute(fieldTag, 'length') || '0', 10),
				align: getAttribute(fieldTag, 'align') || 'right',
				padChar: getAttribute(fieldTag, 'padChar') || ' ',
				decimals: getAttribute(fieldTag, 'decimals')
					? parseInt(getAttribute(fieldTag, 'decimals'), 10)
					: undefined,
				inputType: getAttribute(fieldTag, 'inputType') || null,
				outputType: getAttribute(fieldTag, 'outputType') || null,
			});
		});
	}

	// Line
	const lineMatch = xmlString.match(new RegExp('<Line[^>]*>([\\s\\S]*?)</Line>', 'i'));
	if (lineMatch) {
		const lineTagMatch = xmlString.match(new RegExp('<Line[^>]*>', 'i'));
		if (lineTagMatch) {
			const arrayPathStr = getAttribute(lineTagMatch[0], 'arrayPath') || '';
			schema.line.arrayPath = arrayPathStr.split('/').filter((p) => p);
			schema.line.typeKey = getAttribute(lineTagMatch[0], 'typeKey') || null;
		}

		// Fix: Use [\s\S]*? to match multiline Field tags
		const fieldMatches =
			lineMatch[1].match(new RegExp('<Field[\\s\\S]*?/>|<Field[^>]*>([\\s\\S]*?)</Field>', 'gi')) ||
			[];
		fieldMatches.forEach((fieldMatch) => {
			// Fix: Match multiline Field tags with [\s\S]*?
			const openTagMatch =
				fieldMatch.match(new RegExp('<Field[\\s\\S]*?/>', 'i')) ||
				fieldMatch.match(new RegExp('<Field[^>]*>', 'i'));
			if (!openTagMatch) return;
			const fieldTag = openTagMatch[0];
			schema.line.fields.push({
				name: getAttribute(fieldTag, 'name') || '',
				fixed: getAttribute(fieldTag, 'fixed') || null,
				key: getAttribute(fieldTag, 'key') || null,
				expr: getAttribute(fieldTag, 'expr') || null,
				length: parseInt(getAttribute(fieldTag, 'length') || '0', 10),
				align: getAttribute(fieldTag, 'align') || 'right',
				padChar: getAttribute(fieldTag, 'padChar') || ' ',
				decimals: getAttribute(fieldTag, 'decimals')
					? parseInt(getAttribute(fieldTag, 'decimals'), 10)
					: undefined,
				inputType: getAttribute(fieldTag, 'inputType') || null,
				outputType: getAttribute(fieldTag, 'outputType') || null,
			});
		});
	}

	// Footer
	const footerMatch = xmlString.match(new RegExp('<Footer[^>]*>([\\s\\S]*?)</Footer>', 'i'));
	if (footerMatch) {
		// Fix: Use [\s\S]*? to match multiline Field tags
		const fieldMatches =
			footerMatch[1].match(
				new RegExp('<Field[\\s\\S]*?/>|<Field[^>]*>([\\s\\S]*?)</Field>', 'gi'),
			) || [];
		fieldMatches.forEach((fieldMatch) => {
			// Fix: Match multiline Field tags with [\s\S]*?
			const openTagMatch =
				fieldMatch.match(new RegExp('<Field[\\s\\S]*?/>', 'i')) ||
				fieldMatch.match(new RegExp('<Field[^>]*>', 'i'));
			if (!openTagMatch) return;
			const fieldTag = openTagMatch[0];
			schema.footer.push({
				name: getAttribute(fieldTag, 'name') || '',
				fixed: getAttribute(fieldTag, 'fixed') || null,
				key: getAttribute(fieldTag, 'key') || null,
				expr: getAttribute(fieldTag, 'expr') || null,
				calc: getAttribute(fieldTag, 'calc') || null,
				calcType: getAttribute(fieldTag, 'calcType') || null,
				filterValue: getAttribute(fieldTag, 'filterValue') || null,
				length: parseInt(getAttribute(fieldTag, 'length') || '0', 10),
				align: getAttribute(fieldTag, 'align') || 'right',
				padChar: getAttribute(fieldTag, 'padChar') || ' ',
				decimals: getAttribute(fieldTag, 'decimals')
					? parseInt(getAttribute(fieldTag, 'decimals'), 10)
					: undefined,
				inputType: getAttribute(fieldTag, 'inputType') || null,
				outputType: getAttribute(fieldTag, 'outputType') || null,
			});
		});
	}

	return schema;
}

// ---------------------
//  MAIN: Test execution
// ---------------------
let parsedData = inputData;

if (!xmlSchema) {
	console.error('XML schema bulunamadı.');
	process.exit(1);
}

if (typeof parsedData === 'string') {
	try {
		parsedData = JSON.parse(parsedData);
	} catch (e) {
		console.error('inputDataJson parse edilemedi: ' + (e.message || String(e)));
		process.exit(1);
	}
}

if (!parsedData || typeof parsedData !== 'object') {
	console.error('inputDataJson geçersiz veya boş.');
	process.exit(1);
}

// parse schema
const schema = parseXMLSchema(xmlSchema);

// Debug: log parsed schema
console.log('=== SCHEMA DEBUG ===');
console.log('Line fields count:', schema.line.fields.length);
schema.line.fields.forEach((f) => {
	console.log(`  Field: ${f.name}, key=${f.key}, expr=${f.expr}, length=${f.length}`);
});

// get line items by path
let lineItems = parsedData;
for (const p of schema.line.arrayPath) {
	lineItems = lineItems?.[p];
	if (!lineItems) {
		lineItems = [];
		break;
	}
}
if (!Array.isArray(lineItems)) lineItems = [];

console.log('Line items found:', lineItems.length);
console.log('First item:', JSON.stringify(lineItems[0], null, 2));

// build output lines
const txtLines = [];

// HEADER
for (const f of schema.header) {
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

	// if inputType/outputType are set (rare in header), try convert
	if (f.inputType && f.outputType && val) {
		val = convertDateUniversal(String(val), f.inputType, f.outputType);
	}

	txtLines.push(pad(val, f.length, f.align, f.padChar, f.decimals));
}
txtLines.push('\n');

// LINES
for (const row of lineItems) {
	// Pre-process: Calculate expr fields and add to row for filterValue support
	for (const f of schema.line.fields) {
		if (f.expr && f.key) {
			// If field has both expr and key, calculate expr and store in row with key name
			const val = evalExpression(f.expr, { row, items: lineItems, data: parsedData });
			if (val !== undefined && val !== null) {
				row[f.key] = val;
			}
		}
	}

	for (const f of schema.line.fields) {
		let val = '';

		if (f.fixed) {
			val = f.fixed;
			val = resolveDateFormat(val);
		} else if (f.expr) {
			// allow expr to use bare identifiers (resolved to row then data) AND row/items/data explicitly
			val = evalExpression(f.expr, { row, items: lineItems, data: parsedData });
			// Debug: log ALL expression results
			console.log(`DEBUG [${f.name}]: expr="${f.expr}", result="${val}", type=${typeof val}`);
			// Ensure expression result is converted to string if it's not already
			if (val !== undefined && val !== null) {
				val = String(val);
			} else {
				val = '';
			}
		} else if (f.key) {
			// support path keys
			val = getByPath(row, f.key);
			// if not found in row, try data as fallback
			if ((val === undefined || val === null) && parsedData) val = getByPath(parsedData, f.key);
		}

		// if inputType/outputType provided, use convertDateUniversal for string dates
		if (f.inputType && f.outputType && val) {
			val = convertDateUniversal(String(val), f.inputType, f.outputType);
		}

		// decimals formatting applied if decimals provided and value numeric-like
		if (f.decimals !== undefined && val !== '') {
			const n = Number(val);
			if (!Number.isNaN(n)) {
				// Math.round kullanarak precision sorununu çöz
				const multiplier = Math.pow(10, f.decimals);
				const rounded = Math.round(n * multiplier) / multiplier;
				val = rounded; // toFixed kullanmadan direkt rounded değeri kullan
			}
		}

		txtLines.push(pad(val, f.length, f.align, f.padChar, f.decimals));
	}
	txtLines.push('\n');
}

// FOOTER
// Determine tipKey if needed for grouping/filtering
let tipKey = null;
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

let lastFilterValue = null;
for (let i = 0; i < schema.footer.length; i++) {
	const f = schema.footer[i];
	// check whether we need to inject a type header when calcType=Group + filterValue changes
	let currentFilterValue = null;
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
				(ff) => ff.name.toLowerCase().includes('type') || ff.name.toLowerCase().includes('tip'),
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
	} else if (f.calc) {
		// handle calc: filter by filterValue if present
		let itemsToCalc = lineItems;

		// compute filterValue: support path (contains '/') or expression starting '='
		let resolvedFilterValue = f.filterValue;
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
			itemsToCalc = lineItems.filter((it) => {
				const v = getByPath(it, tipKey);
				return String(v) === String(resolvedFilterValue);
			});
		}
		// support sumExpr: f.calcType === 'sumExpr' and f.expr defined -> sum of expr per line
		if (f.calcType === 'sumExpr' && f.expr) {
			const sum = calcValue('sum', itemsToCalc, null, f.expr);
			if (f.decimals !== undefined && typeof sum === 'number') {
				// Math.round kullanarak precision sorununu çöz
				const multiplier = Math.pow(10, f.decimals);
				val = Math.round(sum * multiplier) / multiplier;
			} else {
				val = sum;
			}
		} else {
			const calcRes = calcValue(f.calcType, itemsToCalc, f.key);
			if (f.decimals !== undefined && typeof calcRes === 'number' && calcRes !== null) {
				// Math.round kullanarak precision sorununu çöz
				const multiplier = Math.pow(10, f.decimals);
				val = Math.round(calcRes * multiplier) / multiplier;
			} else {
				val = calcRes;
			}
		}
	} else if (f.expr) {
		// header/footer level expr: context has data & items
		val = evalExpression(f.expr, { data: parsedData, items: lineItems });
	} else if (f.key) {
		// try parsedData key first (footer-level keys often in header), otherwise fallback to root
		val = getByPath(parsedData, f.key) ?? '';
	}

	// dynamic date conversion if both inputType/outputType present
	if (f.inputType && f.outputType && val) {
		val = convertDateUniversal(String(val), f.inputType, f.outputType);
	}

	txtLines.push(pad(val, f.length, f.align, f.padChar, f.decimals));
}

// final result
const result = txtLines.join('');

console.log('\n=== ÇIKTI ===');
console.log(result);
console.log('\n=== ÇIKTI (Satır Satır) ===');
result.split('\n').forEach((line, idx) => {
	if (line.trim()) {
		console.log(`Satır ${idx + 1}: [${line}] (${line.length} karakter)`);
	}
});

// ---------------------
//  MATEMATİK FONKSİYONLARI TEST (4 İŞLEM)
// ---------------------
console.log('\n=== MATEMATİK FONKSİYONLARI TEST (4 İŞLEM) ===');

// Test verileri
const testRow = { a: 10, b: 3, c: 2.5, d: 7 };
const testData = { multiplier: 2 };

// Toplama (+)
const addTest = evalExpression('a + b', { row: testRow, data: testData });
console.log(
	`Toplama (a + b): ${testRow.a} + ${testRow.b} = ${addTest} (Beklenen: ${testRow.a + testRow.b}) ${addTest === testRow.a + testRow.b ? '✅' : '❌'}`,
);

// Çıkarma (-)
const subTest = evalExpression('a - b', { row: testRow, data: testData });
console.log(
	`Çıkarma (a - b): ${testRow.a} - ${testRow.b} = ${subTest} (Beklenen: ${testRow.a - testRow.b}) ${subTest === testRow.a - testRow.b ? '✅' : '❌'}`,
);

// Çarpma (*)
const mulTest = evalExpression('a * b', { row: testRow, data: testData });
console.log(
	`Çarpma (a * b): ${testRow.a} * ${testRow.b} = ${mulTest} (Beklenen: ${testRow.a * testRow.b}) ${mulTest === testRow.a * testRow.b ? '✅' : '❌'}`,
);

// Bölme (/)
const divTest = evalExpression('a / b', { row: testRow, data: testData });
console.log(
	`Bölme (a / b): ${testRow.a} / ${testRow.b} = ${divTest} (Beklenen: ${testRow.a / testRow.b}) ${Math.abs(divTest - testRow.a / testRow.b) < 0.0001 ? '✅' : '❌'}`,
);

// Karmaşık ifadeler
const complex1 = evalExpression('a + b * c', { row: testRow, data: testData });
const expected1 = testRow.a + testRow.b * testRow.c;
console.log(
	`Karmaşık (a + b * c): ${testRow.a} + ${testRow.b} * ${testRow.c} = ${complex1} (Beklenen: ${expected1}) ${Math.abs(complex1 - expected1) < 0.0001 ? '✅' : '❌'}`,
);

const complex2 = evalExpression('(a + b) * c', { row: testRow, data: testData });
const expected2 = (testRow.a + testRow.b) * testRow.c;
console.log(
	`Karmaşık ((a + b) * c): (${testRow.a} + ${testRow.b}) * ${testRow.c} = ${complex2} (Beklenen: ${expected2}) ${Math.abs(complex2 - expected2) < 0.0001 ? '✅' : '❌'}`,
);

// Decimal işlemler
const decimalTest = evalExpression('c + d', { row: testRow, data: testData });
const expectedDec = testRow.c + testRow.d;
console.log(
	`Decimal (c + d): ${testRow.c} + ${testRow.d} = ${decimalTest} (Beklenen: ${expectedDec}) ${Math.abs(decimalTest - expectedDec) < 0.0001 ? '✅' : '❌'}`,
);

// Helper fonksiyonlar ile
const roundTest = evalExpression('round(c, 0)', { row: testRow, data: testData });
console.log(
	`Round (round(c, 0)): round(${testRow.c}, 0) = ${roundTest} (Beklenen: ${Math.round(testRow.c)}) ${roundTest === Math.round(testRow.c) ? '✅' : '❌'}`,
);

const absTest = evalExpression('abs(a - b * 2)', { row: testRow, data: testData });
const expectedAbs = Math.abs(testRow.a - testRow.b * 2);
console.log(
	`Abs (abs(a - b * 2)): abs(${testRow.a} - ${testRow.b} * 2) = ${absTest} (Beklenen: ${expectedAbs}) ${absTest === expectedAbs ? '✅' : '❌'}`,
);

console.log('\n✅ Matematik fonksiyonları testi tamamlandı!');
