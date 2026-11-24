import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { validateDataset } from '../src/data.js';
import { PUBLIC_FILES } from '../scripts/public-files.mjs';

test('公开仓库完整词库有效且进入构建清单',async()=>{
 const data=validateDataset(JSON.parse(await readFile(new URL('../data/vocabulary.json',import.meta.url),'utf8')));
 assert.equal(data.words.length,3631);assert.equal(data.chapters.length,22);
 assert.ok(PUBLIC_FILES.includes('data/vocabulary.json'));
 const entry=await readFile(new URL('../src/app.js',import.meta.url),'utf8');
 assert.ok(entry.includes('../data/vocabulary.json'));
});
