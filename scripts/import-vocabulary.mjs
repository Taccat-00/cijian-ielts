import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseVocabulary } from '../src/core.js';
const input = resolve(process.argv[2] || 'data/private/vocabulary.txt');
const data = parseVocabulary(await readFile(input, 'utf8'));
const enrichment = JSON.parse(await readFile(new URL('../data/enrichment.json', import.meta.url), 'utf8'));
for (const word of data.words) {
  if (enrichment[word.id]) Object.assign(word, enrichment[word.id], { enrichmentSource: '本项目自编学习示例' });
}
data.importedAt = new Date().toISOString();
await writeFile(new URL('../data/vocabulary.local.json', import.meta.url), JSON.stringify(data, null, 2) + '\n');
console.log(`已导入 ${data.chapters.length} 章、${data.words.length} 个不同词条。`);
console.log(JSON.stringify({ examples: data.words.filter(w => w.example).length, phonetics: data.words.filter(w => w.phonetic).length, translations: data.words.filter(w => w.translation).length, memory: data.words.filter(w => w.memory).length }));
console.log('输出 data/vocabulary.local.json 已被 Git 忽略，公开构建不会包含该文件。');
