import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {initialState,readState,startSession,recordAnswer,expireSession} from '../src/core.js';
import {createPersistence} from '../src/persistence.js';
import {validateDataset,loadDataset} from '../src/data.js';

const word={id:'constructor',word:'constructor',variants:[],meanings:['建造者'],pos:'n.',chapters:['1']};
const options={mode:'zh-en',source:'chapter',label:'测试',count:'all',timed:true,minutes:1};
const ids=new Set([word.id]);
test('普通英文词 constructor 不应被误当成继承属性，笔记和错题往返保存',()=>{
  const state=initialState();
  assert.equal(state.notes.constructor,undefined);
  state.session=startSession([word],options,100);
  recordAnswer(state,word,'wrong',false,200);
  state.notes.constructor='施工者';
  const restored=readState(JSON.stringify(state),ids);
  assert.equal(restored.mistakes.constructor.count,1);
  assert.deepEqual(restored.stats.constructor,{attempts:1,correct:0});
  assert.equal(restored.notes.constructor,'施工者');
  assert.equal(restored.notes.toString,undefined);
});
test('到时前所有题已提交，等待结果按钮时到时也应算完成',()=>{
  const state=initialState(); state.session=startSession([word],options,100);
  recordAnswer(state,word,'constructor',false,200);
  assert.equal(expireSession(state.session,60100),true);
  assert.equal(state.session.reason,'completed');
});
test('损坏的来源、题型、章节和草稿只使该轮失效，笔记不丢',()=>{
  for (const bad of [{source:'unknown'},{mode:'unknown'},{chapterIds:'12'},{chapterIds:['<script>']},{draft:null},{startedAt:null}]) {
    const state=initialState(); state.notes.constructor='keep';
    state.session={...startSession([word],options,100),...bad};
    const restored=readState(JSON.stringify(state),ids);
    assert.equal(restored.session,null,JSON.stringify(bad));
    assert.equal(restored.notes.constructor,'keep');
  }
});
test('非字符串每日词条拒绝读取，防止错误计数继续写入',()=>{
  const state=initialState(); state.daily['2026-11-03']=[{},null,123];
  assert.throws(()=>readState(JSON.stringify(state),ids));
});
function mockStorage(initial=null) {
  let value=initial;
  return {getItem:()=>value,setItem:(_key,next)=>{value=next;},removeItem:()=>{value=null;}};
}
test('两个标签页先后保存，旧页面不得覆盖新收藏或学习成绩',()=>{
  const storage=mockStorage(), first=createPersistence(storage,'state'), second=createPersistence(storage,'state');
  first.save({saved:['oxygen'],correct:2});
  assert.equal(second.isCurrent(),false);
  assert.throws(()=>second.save({saved:[],correct:0}),{code:'STORAGE_CONFLICT'});
  assert.deepEqual(JSON.parse(storage.getItem()),{saved:['oxygen'],correct:2});
});
test('清除浏览器记录后，旧标签页不得重新写回被清除的数据',()=>{
  const storage=mockStorage('{"goal":100}'), page=createPersistence(storage,'state');
  storage.removeItem();
  assert.throws(()=>page.save({goal:100}),{code:'STORAGE_CONFLICT'});
  assert.equal(storage.getItem(),null);
});
test('存储空间不足时保留原数据，恢复空间后可重试',()=>{
  const storage=mockStorage('old'), original=storage.setItem;
  const page=createPersistence(storage,'state');
  storage.setItem=()=>{throw new Error('QuotaExceededError');};
  assert.throws(()=>page.save({goal:200}));
  assert.equal(storage.getItem(),'old');
  storage.setItem=original; page.save({goal:200});
  assert.equal(storage.getItem(),'{"goal":200}');
});
const demo=JSON.parse(await readFile(new URL('../data/demo.json',import.meta.url),'utf8'));
test('两种现有词库通过完整字段与关联检查',async()=>{
  assert.equal(validateDataset(demo),demo);
  try {
    const local=JSON.parse(await readFile(new URL('../data/vocabulary.local.json',import.meta.url),'utf8'));
    assert.equal(validateDataset(local),local);
  } catch (error) {if(error.code!=='ENOENT') throw error;}
});
test('字段缺失、重复词条、悬空章节引用在渲染前拦截',()=>{
  for (const edit of [d=>{d.words[0].variants=null;},d=>{d.words[0].variants=[];},d=>{d.words[0].chapters=['999'];},d=>{d.words.push(d.words[0]);},d=>{d.chapters=[];}]) {
    const data=structuredClone(demo);edit(data);assert.throws(()=>validateDataset(data));
  }
});
test('本地文件不存在时使用公开示例且不显示损坏警告',async()=>{
  const result=await loadDataset(async url=>url==='local'?{ok:false,status:404}:{ok:true,json:async()=>demo},'local','demo');
  assert.equal(result.dataset.words.length,54); assert.equal(result.warning,'');
});
test('本地 JSON 或词条结构损坏时仍能加载示例，并明确提示',async()=>{
  for (const json of [async()=>{throw new Error('invalid JSON');},async()=>({words:[{}],chapters:[]})]) {
    const result=await loadDataset(async url=>url==='local'?{ok:true,json}:{ok:true,json:async()=>demo},'local','demo');
    assert.equal(result.dataset.words.length,54); assert.match(result.warning,/示例词库/);
  }
});
test('网络错误可回退，两份词库都失败则明确报错',async()=>{
  const result=await loadDataset(async url=>{if(url==='local') throw new Error('offline');return {ok:true,json:async()=>demo};},'local','demo');
  assert.equal(result.dataset.words.length,54);
  await assert.rejects(loadDataset(async()=>({ok:false,status:500}),'local','demo'));
});
