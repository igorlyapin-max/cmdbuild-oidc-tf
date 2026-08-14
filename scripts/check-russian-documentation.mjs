import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const roots = ['README.ru.md', ...readdirSync('docs', { recursive: true })
  .filter((name) => name.endsWith('.ru.md'))
  .map((name) => join('docs', name))];
const banned = /\b(?:atomic helper|helper)\b/i;
const failures = [];
for (const file of roots) {
  const text = readFileSync(file, 'utf8').replace(/```[\s\S]*?```/g, '');
  for (const [index, line] of text.split('\n').entries()) {
    if (banned.test(line)) failures.push(`${file}:${index + 1}: ${line.trim()}`);
  }
}
if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}
console.log(`Russian documentation terminology: ${roots.length} files OK`);
