import { PUBLIC_FILES } from './public-files.mjs';
import { mkdir, copyFile, readdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
const destination = resolve('dist');
const files = PUBLIC_FILES;
const allowed = new Set(files);
for (const file of files) {
  const parts = file.split('/');
  for (let i = 1; i < parts.length; i++) allowed.add(parts.slice(0,i).join('/'));
}
await mkdir(destination, { recursive: true });
// Only these public artifacts may appear in the output. Preserve unexpected files
// and fail rather than deleting them or accidentally including them in a release.
const existing = await readdir(destination, { recursive: true });
if (existing.some(path => !allowed.has(path.replaceAll('\\', '/')))) throw new Error('dist 包含预期之外的文件，请先移走这些文件再构建');
for (const name of files) {
  await mkdir(dirname(resolve(destination, name)), { recursive: true });
  await copyFile(resolve(name), resolve(destination, name));
}
console.log('已构建 dist/：包含网站源码、完整 3631 词词库及备用示例，不包含原始词表和个人学习数据。');
