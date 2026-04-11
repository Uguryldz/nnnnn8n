const fs = require('fs');
const path = require('path');

// Test kodunu oku
const testCode = fs.readFileSync(path.join(__dirname, 'test_code.js'), 'utf8');
const inputData = JSON.parse(fs.readFileSync(path.join(__dirname, 'input.json'), 'utf8'));

const templates = ['templatecamlye.xml', 'template_example.xml', 'template_limit_export.xml'];

templates.forEach((templateName, index) => {
	console.log(`\n${'='.repeat(60)}`);
	console.log(`TEST ${index + 1}: ${templateName}`);
	console.log('='.repeat(60));

	try {
		const xmlSchema = fs.readFileSync(path.join(__dirname, 'limittemplate', templateName), 'utf8');

		// Test kodunu çalıştır (eval yerine require kullan)
		const testCodeModified = testCode
			.replace(
				/const xmlSchema = fs\.readFileSync\([^;]+\);/,
				`const xmlSchema = \`${xmlSchema.replace(/`/g, '\\`')}\`;`,
			)
			.replace(
				/const inputData = JSON\.parse\(fs\.readFileSync\([^;]+\)\);/,
				`const inputData = ${JSON.stringify(inputData)};`,
			);

		// Test kodunu çalıştır
		eval(testCodeModified);
	} catch (error) {
		console.error(`HATA: ${error.message}`);
	}
});
