import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {createStaticServer} from '../scripts/serve.mjs';
import {PUBLIC_FILES} from '../scripts/public-files.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
async function withServer(local, action) {
  const server=createStaticServer(root,{local});
  try {
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
    await action('http://127.0.0.1:'+server.address().port);
  } finally { server.closeAllConnections();await new Promise(resolve=>server.close(resolve)); }
}
test('静态首页、模块、HEAD 和错误方法均正确响应',()=>withServer(true,async base=>{
  for (const path of ['/',...PUBLIC_FILES.map(file=>'/'+file)]) {
    const response=await fetch(base+path);assert.equal(response.status,200,path);
    assert.equal(response.headers.get('cache-control'),'no-cache');
  }
  const head=await fetch(base+'/',{method:'HEAD'});assert.equal(head.status,200);assert.equal(await head.text(),'');
  assert.equal((await fetch(base+'/',{method:'POST'})).status,405);
}));
test('禁止 Windows 大小写、编码、尾点等路径访问原始词表和项目资料',()=>withServer(true,async base=>{
  for (const path of ['/data/private/vocabulary.txt','/data/PRIVATE/vocabulary.txt','/data/private./vocabulary.txt','/data/private%5cvocabulary.txt','/data/enrichment.json','/.git/config','/README.md','/src/app.js::$DATA','/%E0%A4%A']) {
    assert.equal((await fetch(base+path)).status,404,path);
  }
}));
test('公开服务即使根目录存在本地词库也不允许访问',()=>withServer(false,async base=>{
  assert.equal((await fetch(base+'/data/vocabulary.local.json')).status,404);
  assert.equal((await fetch(base+'/data/demo.json')).status,200);
}));
