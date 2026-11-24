import test from 'node:test';
import assert from 'node:assert/strict';
import { initialState, STORAGE_KEY, startSession, recordAnswer, nextQuestion } from '../src/core.js';
import { createReviewPersistence } from '../src/persistence.js';
import { BACKUP_KEY, readV2 } from '../src/review/schema.js';
import { evaluateMemory, practiceEvent } from '../src/review/engine.js';

const now=Date.parse('2026-11-20T12:00:00Z');
const options={clock:()=>now,timeZone:'UTC',singleTab:true,locks:null,sessionIdFactory:()=> 'migrated'};
function storage(initial=null) {
  const map=new Map(initial===null ? [] : [[STORAGE_KEY,initial]]);
  return {map,failKey:null,writes:[],getItem:key=>map.get(key)??null,removeItem:key=>map.delete(key),
    setItem(key,value){if(this.failKey===key)throw new Error('QuotaExceededError');this.writes.push(key);map.set(key,value);}};
}
const open=(store,opts={})=>createReviewPersistence(store,{...options,...opts});
const word={id:'constructor',word:'constructor',variants:['constructor'],meanings:['建造者'],chapters:['1']};
const config={mode:'zh-en',source:'chapter',label:'test',count:'all',timed:false};
async function active(store) {
  const repo=await open(store);
  await repo.transact(s=>{s.session={...startSession([word],config,now),sessionId:'session'};});
  return repo;
}
function reduceAnswer(s) {
  recordAnswer(s,word,'constructor',false,now);
  const event=practiceEvent(s.session,s.session.index);
  s.srs.memories[word.id]=evaluateMemory(s.srs.memories[word.id],event,s.srs.timeZone).memory;
}
const event={sessionId:'session',questionIndex:0};

test('空白仓储仅显式提交才写入，revision逐次递增，读取不改值',async()=>{
  const store=storage(),repo=await open(store);
  assert.equal(store.getItem(STORAGE_KEY),null);
  const candidate=repo.snapshot();candidate.goal=150;
  const saved=await repo.commit(candidate);
  assert.equal(candidate.revision,0);assert.equal(saved.revision,1);
  const detached=repo.snapshot();detached.goal=1;assert.equal(repo.snapshot().goal,150);
  await repo.transact(s=>{s.saved.push('a');});assert.equal(repo.snapshot().revision,2);
  const raw=store.getItem(STORAGE_KEY),restored=await open(store,{clock:()=>now+86400000,timeZone:'Asia/Shanghai'});
  assert.equal(restored.raw,raw);assert.equal(restored.snapshot().srs.timeZone,'UTC');
  assert.equal(store.getItem(STORAGE_KEY),raw);
});

test('迁移须显式开启，先备份原始字符串，保留旧数据和稳定会话标识',async()=>{
  const old=initialState();old.saved=['word'];old.daily['2026-11-19']=['known'];
  old.session=startSession([word],config,now);
  const raw=JSON.stringify(old,null,2),store=storage(raw);
  await assert.rejects(open(store),{code:'MIGRATION_REQUIRED'});assert.equal(store.writes.length,0);
  const repo=await open(store,{migrate:true});
  assert.deepEqual(store.writes,[BACKUP_KEY,STORAGE_KEY]);assert.equal(store.getItem(BACKUP_KEY),raw);
  assert.equal(repo.snapshot().session.sessionId,'migrated');assert.equal(repo.snapshot().revision,0);
  assert.deepEqual(repo.snapshot().daily,old.daily);
  await open(store,{migrate:true});assert.deepEqual(store.writes,[BACKUP_KEY,STORAGE_KEY]);
});

test('备份失败及容量不足不覆盖主键；恢复后可重试迁移',async()=>{
  for (const failKey of [BACKUP_KEY,STORAGE_KEY]) {
    const raw=JSON.stringify(initialState()),store=storage(raw);store.failKey=failKey;
    await assert.rejects(open(store,{migrate:true}),/QuotaExceededError/);
    assert.equal(store.getItem(STORAGE_KEY),raw);
    if(failKey===STORAGE_KEY)assert.equal(store.getItem(BACKUP_KEY),raw);
    store.failKey=null;const repo=await open(store,{migrate:true});
    assert.equal(repo.snapshot().version,2);assert.equal(store.getItem(BACKUP_KEY),raw);
  }
});

test('不同备份、坏JSON、损坏旧会话、未知新版本均停止写入',async()=>{
  const raw=JSON.stringify(initialState()),store=storage(raw);store.map.set(BACKUP_KEY,'different');
  await assert.rejects(open(store,{migrate:true}),{code:'BACKUP_CONFLICT'});
  assert.equal(store.getItem(STORAGE_KEY),raw);assert.equal(store.getItem(BACKUP_KEY),'different');
  for (const bad of ['{','{"version":3}',JSON.stringify({...initialState(),session:{}})]) {
    const broken=storage(bad);await assert.rejects(open(broken,{migrate:true}));
    assert.equal(broken.getItem(STORAGE_KEY),bad);assert.deepEqual(broken.writes,[]);
  }
});

test('提交完整根快照，重复事件在刷新后也不再次执行更新函数',async()=>{
  const store=storage(),repo=await active(store),baseline=repo.snapshot().revision;
  const result=await repo.transact(reduceAnswer,{event});
  assert.equal(result.accepted,true);assert.equal(result.state.revision,baseline+1);
  const durable=readV2(store.getItem(STORAGE_KEY));
  assert.equal(durable.session.answers.length,1);assert.equal(durable.session.answers[0].eventId,'session:0');
  assert.equal(durable.stats.constructor.attempts,1);assert.deepEqual(durable.daily['2026-11-20'],['constructor']);
  assert.equal(durable.srs.memories.constructor.learningHistory.length,1);
  let calls=0;
  for(const repository of [repo,await open(store)]) {
    const duplicate=await repository.transact(()=>{calls++;},{event});assert.equal(duplicate.accepted,false);
  }
  assert.equal(calls,0);assert.equal(store.getItem(STORAGE_KEY),JSON.stringify(durable));
});

test('保存失败保持权威快照，原事件重试只提交一次',async()=>{
  const store=storage(),repo=await active(store),raw=store.getItem(STORAGE_KEY),before=repo.snapshot();
  store.failKey=STORAGE_KEY;
  await assert.rejects(repo.transact(reduceAnswer,{event}),/QuotaExceededError/);
  assert.equal(store.getItem(STORAGE_KEY),raw);assert.equal(repo.raw,raw);assert.deepEqual(repo.snapshot(),before);
  store.failKey=null;await repo.transact(reduceAnswer,{event});
  assert.equal(repo.snapshot().stats.constructor.attempts,1);
  assert.equal(repo.snapshot().srs.memories.constructor.repetition,1);
});

test('双击并发提交在本仓储排队，另一个真实题目可再次观察同词',async()=>{
  const store=storage(),repo=await active(store);
  const results=await Promise.all([repo.transact(reduceAnswer,{event}),repo.transact(reduceAnswer,{event})]);
  assert.deepEqual(results.map(r=>r.accepted),[true,false]);
  await repo.transact(s=>{nextQuestion(s.session,now);s.session={...startSession([word],config,now),sessionId:'another'};});
  await repo.transact(reduceAnswer,{event:{sessionId:'another',questionIndex:0}});
  const state=repo.snapshot();assert.equal(state.stats.constructor.attempts,2);
  assert.equal(state.daily['2026-11-20'].length,1);assert.equal(state.srs.memories.constructor.repetition,2);
  assert.equal(state.srs.memories.constructor.learningHistory.length,2);
});

test('根快照冲突、清空存储、过期修订号不会覆盖较新记录',async()=>{
  const store=storage(),first=await open(store),second=await open(store),stale=first.snapshot();
  await first.transact(s=>{s.saved.push('a');});
  await assert.rejects(second.transact(s=>{s.saved=[];}),{code:'STORAGE_CONFLICT'});
  await assert.rejects(first.commit(stale),{code:'REVISION_CONFLICT'});
  const latest=store.getItem(STORAGE_KEY);assert.deepEqual(JSON.parse(latest).saved,['a']);
  store.removeItem(STORAGE_KEY);await assert.rejects(first.commit(first.snapshot()),{code:'STORAGE_CONFLICT'});
  assert.equal(store.getItem(STORAGE_KEY),null);
});

test('没有Web Locks时必须明确单标签页模式，已有v2仍可只读',async()=>{
  const store=storage();await assert.rejects(open(store,{singleTab:false}),{code:'SINGLE_TAB_REQUIRED'});
  const repo=await open(store);await repo.commit(repo.snapshot());
  const reader=await open(store,{singleTab:false});assert.equal(reader.snapshot().version,2);
  await assert.rejects(reader.commit(reader.snapshot()),{code:'SINGLE_TAB_REQUIRED'});
});

test('Web Locks保护初始化和提交，跨仓储仍拒绝过期快照',async()=>{
  let tail=Promise.resolve();const requests=[];
  const locks={request(name,options,fn){requests.push({name,options});const result=tail.then(fn);tail=result.catch(()=>{});return result;}};
  const store=storage(),a=await open(store,{locks,singleTab:false}),b=await open(store,{locks,singleTab:false});
  const results=await Promise.allSettled([a.transact(s=>{s.goal=200;}),b.transact(s=>{s.goal=300;})]);
  assert.equal(results[0].status,'fulfilled');assert.equal(results[1].reason.code,'STORAGE_CONFLICT');
  assert.equal(a.mode,'web-locks');assert.equal(requests.length,4);
  assert.ok(requests.every(r=>r.name===`cijian:root:${STORAGE_KEY}` && r.options.mode==='exclusive'));
});

test('拒绝过期会话、错题位、未提交答案、异步更新和自动更换学习时区',async()=>{
  const store=storage(),repo=await active(store),raw=store.getItem(STORAGE_KEY);
  await assert.rejects(repo.transact(()=>{}, {event:{sessionId:'old',questionIndex:0}}),{code:'STALE_EVENT'});
  await assert.rejects(repo.transact(()=>{}, {event:{sessionId:'session',questionIndex:1}}),{code:'STALE_EVENT'});
  await assert.rejects(repo.transact(()=>{}, {event}),/一份答案/);
  await assert.rejects(repo.transact(()=>Promise.resolve()),/同步/);
  await assert.rejects(repo.transact(s=>{s.srs.timeZone='Asia/Shanghai';}),/不可自动更改/);
  assert.equal(store.getItem(STORAGE_KEY),raw);
});

test('全部 FSRS 日志在多次作答与存储恢复后保留，原始统计不变',async()=>{
  const store=storage(),repo=await active(store);
  for(let i=0;i<23;i++) {
    if(i)await repo.transact(s=>{s.session={...startSession([word],config,now),sessionId:`repeat-${i}`};});
    const id=repo.snapshot().session.sessionId;
    await repo.transact(reduceAnswer,{event:{sessionId:id,questionIndex:0}});
  }
  const restored=(await open(store)).snapshot(),memory=restored.srs.memories.constructor;
  assert.equal(memory.learningHistory.length,23);assert.equal(memory.historySummary.count,0);
  assert.equal(memory.dayEvaluation.eventIds.length,23);assert.equal(memory.repetition,23);
  assert.equal(restored.stats.constructor.attempts,23);assert.equal(restored.daily['2026-11-20'].length,1);
});

test('已计分的旧会话答案不会在迁移后重复接入，跳过不产生记忆',async()=>{
  const old=initialState();old.session=startSession([word],config,now);
  recordAnswer(old,word,'constructor',false,now);
  const store=storage(JSON.stringify(old)),repo=await open(store,{migrate:true});
  const raw=store.getItem(STORAGE_KEY);
  await assert.rejects(repo.transact(()=>{throw new Error('不应执行');}, {event:{sessionId:'migrated',questionIndex:0}}),{code:'STALE_EVENT'});
  assert.equal(store.getItem(STORAGE_KEY),raw);
  await repo.transact(s=>{s.session={...startSession([word],config,now),sessionId:'skip'};});
  await repo.transact(s=>{recordAnswer(s,word,'',true,now);}, {event:{sessionId:'skip',questionIndex:0}});
  const state=repo.snapshot();assert.equal(state.srs.memories.constructor.lastReviewedAt,null);
  assert.equal(state.mistakes.constructor.count,1);assert.equal(state.stats.constructor.attempts,2);
  assert.equal(state.daily['2026-11-20'].length,1);
});

test('计时结束和跨词时钟回退拒绝提交，不产生部分记录',async()=>{
  const store=storage(),repo=await active(store);
  await repo.transact(reduceAnswer,{event});
  await repo.transact(s=>{s.session={...startSession([{...word,id:'other'}],config,now),sessionId:'next'};});
  const raw=store.getItem(STORAGE_KEY),backwards=await open(store,{clock:()=>now-1});
  await assert.rejects(backwards.transact(reduceAnswer,{event:{sessionId:'next',questionIndex:0}}),{code:'CLOCK_ROLLBACK'});
  assert.equal(store.getItem(STORAGE_KEY),raw);
  await repo.transact(s=>{s.session={...startSession([word],{...config,timed:true,minutes:1},now),sessionId:'timed'};});
  const expired=await open(store,{clock:()=>now+60000});
  await assert.rejects(expired.transact(()=>{}, {event:{sessionId:'timed',questionIndex:0}}),{code:'STALE_EVENT'});
  assert.equal(expired.snapshot().session.answers.length,0);
});
