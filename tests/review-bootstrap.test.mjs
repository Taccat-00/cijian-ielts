import test from 'node:test';
import assert from 'node:assert/strict';
import { initialState, STORAGE_KEY } from '../src/core.js';
import { BACKUP_KEY, createV2State } from '../src/review/schema.js';
import { openLearningStorage } from '../src/review/bootstrap.js';

const now=Date.parse('2026-11-20T12:00:00Z');
function locks() {
  const held=new Map();
  return {request(name,options,callback){
    const prior=held.get(name);
    if(prior && options.ifAvailable)return Promise.resolve(callback(null));
    const result=(prior ?? Promise.resolve()).catch(()=>{}).then(()=>callback({name}));
    held.set(name,result);
    const clear=()=>{if(held.get(name)===result)held.delete(name);};result.then(clear,clear);return result;
  }};
}
function storage(raw=null) {
  const map=new Map(raw===null?[]:[[STORAGE_KEY,raw]]);
  return {map,writes:0,fail:false,getItem:k=>map.get(k)??null,setItem(k,v){if(this.fail)throw new Error('QuotaExceededError');this.writes++;map.set(k,v);}};
}
const options=()=>({clock:()=>now,timeZone:'UTC',locks:locks()});

test('首次v2初始化与已有v2启动，同一应用lease排斥第二个写入页',async()=>{
  const store=storage(),config=options(),first=await openLearningStorage(store,config);
  try {
    assert.equal(first.writable,true);assert.equal(first.state.version,2);
    await first.repository.commit(first.state);
    const raw=store.getItem(STORAGE_KEY),second=await openLearningStorage(store,config);
    assert.equal(second.writable,false);assert.equal(second.repository,null);assert.match(second.warning,/只读/);
    assert.equal(store.getItem(STORAGE_KEY),raw);
  }finally{first.release();}
  await new Promise(setImmediate);
  const next=await openLearningStorage(store,config);assert.equal(next.writable,true);next.release();
});
test('v1启动需要明确升级，原始备份和历史记录保持，不默认自动迁移',async()=>{
  const old=initialState();old.goal=30;old.saved=['constructor'];old.notes.constructor='旧笔记';old.daily['2026-11-19']=['constructor'];
  const raw=JSON.stringify(old),store=storage(raw),config=options();
  await assert.rejects(openLearningStorage(store,config),{code:'MIGRATION_REQUIRED'});assert.equal(store.writes,0);
  const result=await openLearningStorage(store,{...config,allowMigration:true});
  try {
    assert.equal(store.getItem(BACKUP_KEY),raw);assert.equal(result.state.version,2);assert.equal(result.state.goal,30);
    assert.equal(result.state.notes.constructor,'旧笔记');assert.deepEqual(result.state.saved,['constructor']);
  }finally{result.release();}
});
test('无Web Locks、用户只读浏览时均不暗传singleTab，不写入任何存储',async()=>{
  for(const raw of [null,JSON.stringify(initialState()),JSON.stringify(createV2State({now,timeZone:'UTC'}))]) {
    const store=storage(raw),result=await openLearningStorage(store,{...options(),locks:null,allowMigration:true});
    assert.equal(result.writable,false);assert.equal(result.repository,null);assert.equal(store.writes,0);assert.equal(store.getItem(STORAGE_KEY),raw);
  }
  const store=storage(JSON.stringify(initialState()));
  const preview=await openLearningStorage(store,{...options(),readOnly:true});
  assert.equal(preview.writable,false);assert.equal(store.writes,0);
});
test('升级失败释放lease，修复容量后可恢复，坏JSON与高版本从不覆盖',async()=>{
  const store=storage(JSON.stringify(initialState())),config={...options(),allowMigration:true};store.fail=true;
  await assert.rejects(openLearningStorage(store,config),/Quota/);store.fail=false;await new Promise(setImmediate);
  const result=await openLearningStorage(store,config);assert.equal(result.writable,true);result.release();
  for(const raw of ['{','{"version":3}']) {
    const broken=storage(raw);await assert.rejects(openLearningStorage(broken,{...options(),allowMigration:true}));
    assert.equal(broken.getItem(STORAGE_KEY),raw);assert.equal(broken.writes,0);
  }
});
