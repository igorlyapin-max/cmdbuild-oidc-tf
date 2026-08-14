import { readFileSync } from 'node:fs';

const required = [
  'https://cmdb.example.org/cmdbuild',
  'https://fam.example.org',
  'cmdbuild-api',
  'https://bff.example.org/oauth/callback',
  'https://openwebui.example.org/oauth/clients/mcp:cmdbuild-mcp/callback',
  'https://mcp.example.org',
  'cmdbuild-mcp',
  'fam-reader-001',
  'fam-editor-001',
];
for (const file of ['docs/customer/fam-example.ru.md', 'docs/customer/configuration.ru.md']) {
  const text = readFileSync(file, 'utf8');
  for (const value of required) {
    if (file.endsWith('configuration.ru.md') && ['fam-reader-001', 'fam-editor-001'].includes(value)) continue;
    if (!text.includes(value)) throw new Error(`${file}: missing FAM example value ${value}`);
  }
}
console.log('customer FAM example: consistent values OK');
