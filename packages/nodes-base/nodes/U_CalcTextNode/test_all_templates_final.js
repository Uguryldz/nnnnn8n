const fs = require('fs');
const path = require('path');

// Test kodunu oku
const testCode = fs.readFileSync(path.join(__dirname, 'test_code.js'), 'utf8');
const limitInputData = JSON.parse(fs.readFileSync(path.join(__dirname, 'input.json'), 'utf8'));
const faturaInputData = JSON.parse(fs.readFileSync(path.join(__dirname, 'invinput.json'), 'utf8'));

// Limit template'leri (input.json kullanır)
const limitTemplates = [
	{ name: 'template_example.xml', input: limitInputData, folder: 'limittemplate' },
	{ name: 'template_limit_export.xml', input: limitInputData, folder: 'limittemplate' },
	{ name: 'templatecamlye.xml', input: limitInputData, folder: 'limittemplate' },
	{ name: 'template_advanced_example.xml', input: limitInputData, folder: 'limittemplate' },
];

// Fatura template'leri (invinput.json kullanır)
const faturaTemplates = [
	{ name: 'template_fatura_camliyem.xml', input: faturaInputData, folder: 'faturatemplate' },
	{ name: 'template_fatura_polisan.xml', input: faturaInputData, folder: 'faturatemplate' },
	{ name: 'template_fatura_emas.xml', input: faturaInputData, folder: 'faturatemplate' },
	{ name: 'template_tahsilat.xml', input: faturaInputData, folder: 'faturatemplate' },
];

const allTemplates = [...limitTemplates, ...faturaTemplates];

let successCount = 0;
let failCount = 0;
const results = [];

allTemplates.forEach((template, index) => {
	console.log(`\n${'='.repeat(80)}`);
	console.log(`TEST ${index + 1}/${allTemplates.length}: ${template.folder}/${template.name}`);
	console.log('='.repeat(80));

	try {
		const xmlSchema = fs.readFileSync(path.join(__dirname, template.folder, template.name), 'utf8');

		// Test kodunu çalıştır (eval yerine require kullan)
		const testCodeModified = testCode
			.replace(
				/const xmlSchema = fs\.readFileSync\([^;]+\);/,
				`const xmlSchema = \`${xmlSchema.replace(/`/g, '\\`')}\`;`,
			)
			.replace(
				/const inputData = JSON\.parse\(fs\.readFileSync\([^;]+\)\);/,
				`const inputData = ${JSON.stringify(template.input)};`,
			);

		// Test kodunu çalıştır ve çıktıyı yakala
		let output = '';
		const originalLog = console.log;
		const originalError = console.error;
		const originalWarn = console.warn;

		console.log = (...args) => {
			output += args.join(' ') + '\n';
			originalLog(...args);
		};
		console.error = (...args) => {
			output += args.join(' ') + '\n';
			originalError(...args);
		};
		console.warn = (...args) => {
			output += args.join(' ') + '\n';
			originalWarn(...args);
		};

		eval(testCodeModified);

		// Restore console
		console.log = originalLog;
		console.error = originalError;
		console.warn = originalWarn;

		// Çıktıyı kontrol et
		const hasError =
			output.includes('HATA') || output.includes('error') || output.includes('Error');
		const hasOutput = output.includes('=== ÇIKTI ===');

		if (hasError) {
			console.log(`❌ BAŞARISIZ: ${template.name}`);
			failCount++;
			results.push({ template: template.name, status: 'FAIL', error: 'Hata tespit edildi' });
		} else if (hasOutput) {
			console.log(`✅ BAŞARILI: ${template.name}`);
			successCount++;
			results.push({ template: template.name, status: 'SUCCESS' });
		} else {
			console.log(`⚠️  UYARI: ${template.name} - Çıktı bulunamadı`);
			failCount++;
			results.push({ template: template.name, status: 'WARNING', error: 'Çıktı bulunamadı' });
		}
	} catch (error) {
		console.error(`❌ HATA: ${template.name} - ${error.message}`);
		failCount++;
		results.push({ template: template.name, status: 'FAIL', error: error.message });
	}
});

// Özet rapor
console.log(`\n${'='.repeat(80)}`);
console.log('TEST ÖZET RAPORU');
console.log('='.repeat(80));
console.log(`Toplam Template: ${allTemplates.length}`);
console.log(`✅ Başarılı: ${successCount}`);
console.log(`❌ Başarısız: ${failCount}`);
console.log(`\nDetaylı Sonuçlar:`);
results.forEach((r) => {
	const icon = r.status === 'SUCCESS' ? '✅' : r.status === 'WARNING' ? '⚠️' : '❌';
	console.log(`${icon} ${r.template}: ${r.status}${r.error ? ' - ' + r.error : ''}`);
});

if (failCount === 0) {
	console.log(`\n🎉 TÜM TEMPLATE'LER BAŞARIYLA TEST EDİLDİ!`);
	process.exit(0);
} else {
	console.log(`\n⚠️  BAZI TEMPLATE'LERDE SORUN VAR!`);
	process.exit(1);
}
