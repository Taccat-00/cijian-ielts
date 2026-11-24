import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fsrs, generatorParameters, createEmptyCard, Rating} from 'ts-fsrs';
import {evaluateMemory, eventId} from '../src/review/engine.js';
import {scheduleFSRS, serializeFSRS, restoreCard, FSRS_CONFIG} from '../src/review/fsrs.js';
import {createV2State, readV2, validateV2, upgradeFSRS, FSRS_BACKUP_KEY} from '../src/review/schema.js';
import {createReviewPersistence} from '../src/persistence.js';
import {createLearningService} from '../src/review/service.js';
import {openLearningStorage} from '../src/review/bootstrap.js';
import {STORAGE_KEY} from '../src/core.js';
import {learningDay} from '../src/review/calendar.js';

const at=Date.parse('2026-11-23T12:00:00Z');
const params=generatorParameters({request_retention:0.9,enable_short_term:false});
const official=fsrs(params), grades={again:Rating.Again,hard:Rating.Hard,good:Rating.Good};
let serial=0;
const event=(grade,time=at)=>({sessionId:`fsrs-${++serial}`,questionIndex:0,eventId:eventId(`fsrs-${serial}`,0),
  wordId:'w',type:'zh-en',source:'chapter',at:time,grade});
function store(raw=null) {
  const map=new Map(raw===null?[]:[[STORAGE_KEY,raw]]);
  return {map,writes:[],fail:null,getItem:k=>map.get(k)??null,setItem(k,v){
    if(this.fail===k)throw new Error('QuotaExceededError');this.writes.push(k);map.set(k,v);
  }};
}
const open=(storage,now=at)=>createReviewPersistence(storage,{clock:typeof now==='function'?now:()=>now,timeZone:'UTC',singleTab:true,locks:null});
const data={chapters:[{id:'1'}],words:['w','x','y','z'].map(id=>({id,word:id,variants:[id],meanings:['词'],chapters:['1']}))};
const ordinary={mode:'zh-en',source:'chapter',label:'测试',count:'all',timed:false};

test('随站点分发的 ESM 和 MIT 许可证与固定 npm 包逐字节一致',async()=>{
  assert.deepEqual(await readFile(new URL('../src/vendor/ts-fsrs-5.2.3.js',import.meta.url)),
    await readFile(new URL('../node_modules/ts-fsrs/dist/index.mjs',import.meta.url)));
  assert.deepEqual(await readFile(new URL('../src/vendor/ts-fsrs-LICENSE.txt',import.meta.url)),
    await readFile(new URL('../node_modules/ts-fsrs/LICENSE',import.meta.url)));
  assert.equal(FSRS_CONFIG.model,'FSRS-6');assert.equal(params.w.length,21);
});

for(const grade of Object.keys(grades))test(`新词首次 ${grade} 完整状态和日志等于官方库`,()=>{
  const e=event(grade), expected=serializeFSRS(official.next(createEmptyCard(new Date(at)),new Date(at),grades[grade]));
  const m=evaluateMemory(null,e,'Asia/Shanghai').memory;
  assert.deepEqual(m.fsrs,expected.card);assert.deepEqual(m.learningHistory[0].fsrsLog,expected.log);
  assert.equal(m.nextReviewAt,learningDay(Date.parse(expected.card.due),'Asia/Shanghai'));
  assert.equal(m.fsrs.reps,1);assert.equal(m.fsrs.lapses,0);
});

test('Again 和 Good 有不同的记忆状态；分钟步骤关闭但不覆盖库的 due',()=>{
  const again=scheduleFSRS(null,'again',at),good=scheduleFSRS(null,'good',at);
  assert.notDeepEqual(again.card,good.card);
  for(const {card} of [again,good])assert.ok(Date.parse(card.due)>=at+86400000);
});

test('到期、提前、逾期、遗忘和同日独立再学习逐次调用官方库',()=>{
  let memory=null,card=createEmptyCard(new Date(at));
  const sequence=[['good',at],['good',at+86400000],['again',at+30*86400000],
    ['good',at+30*86400000+60000],['hard',at+32*86400000],['good',at+200*86400000]];
  for(const [grade,time] of sequence) {
    const before=structuredClone(memory),e=event(grade,time),expected=official.next(card,new Date(time),grades[grade]);
    const result=evaluateMemory(memory,e,'UTC');assert.equal(result.accepted,true);
    assert.deepEqual(memory,before,'输入不得被修改');memory=result.memory;
    assert.deepEqual(memory.fsrs,serializeFSRS(expected.card));
    assert.deepEqual(memory.learningHistory.at(-1).fsrsLog,serializeFSRS(expected.log));
    card=expected.card;
    const state=createV2State({now:at,timeZone:'UTC'});state.srs.memories.w=memory;
    assert.deepEqual(readV2(JSON.stringify(state)),state);
  }
  assert.equal(memory.fsrs.reps,sequence.length);assert.ok(memory.fsrs.lapses>0);
});

test('超过20条真实 FSRS 日志完整保存，跨日重复事件也不重复调度',()=>{
  let m=null;const first=event('again');m=evaluateMemory(m,first,'UTC').memory;
  for(let i=1;i<25;i++)m=evaluateMemory(m,event('good',at+i*86400000),'UTC').memory;
  m=JSON.parse(JSON.stringify(m));assert.equal(m.learningHistory.length,25);
  assert.equal(evaluateMemory(m,first,'UTC').accepted,false);
  assert.throws(()=>evaluateMemory(m,event('good',at),'UTC'),/时钟回退/);
  const restored=restoreCard(m.fsrs);assert.ok(restored.due instanceof Date);assert.ok(restored.last_review instanceof Date);
  assert.throws(()=>restoreCard({...m.fsrs,due:'2026-11-23'}));
  assert.throws(()=>restoreCard({...m.fsrs,stability:NaN}));
});

// Written by the untouched pre-upgrade schema/engine, including >20 observations.
const oldRaw=await readFile(new URL('./fixtures/pre-fsrs-v2.json',import.meta.url),'utf8');
test('旧v2迁移幂等，保留全部业务属性和到期日期，直到真实复习才采用 FSRS',async()=>{
  const old=JSON.parse(oldRaw),s=store(oldRaw),repo=await open(s);
  assert.equal(s.getItem(FSRS_BACKUP_KEY),oldRaw);
  const migrated=repo.snapshot();assert.equal(migrated.srs.algorithmVersion,2);
  for(const key of ['saved','notes','mistakes','daily','stats','goal','session'])assert.deepEqual(serializeFSRS(migrated[key]),old[key]);
  for(const key of ['memories','dailyPlans','legacyLearnedIds','planSettings','timeZone'])assert.deepEqual(serializeFSRS(migrated.srs[key]),old.srs[key]);
  assert.deepEqual(upgradeFSRS(migrated),migrated);
  const writes=s.writes.length;await open(s,at+86400000);assert.equal(s.writes.length,writes);
  const service=createLearningService(repo,data,{clock:()=>at,idFactory:()=>`real-${++serial}`});
  await service.startOrdinary([data.words[0]],ordinary);
  const session=service.snapshot().session;
  await service.submit({sessionId:session.sessionId,questionIndex:0,input:'w'});
  const memory=service.snapshot().srs.memories.w;
  assert.equal(memory.fsrs.reps,1,'不伪造或回放截断的旧评分');
  assert.deepEqual(memory.learningHistory.slice(0,-1),old.srs.memories.w.learningHistory);
  assert.deepEqual(memory.historySummary,old.srs.memories.w.historySummary);
  assert.equal(memory.legacySchedule.nextReviewAt,old.srs.memories.w.nextReviewAt);
  assert.equal(memory.introducedAt,old.srs.memories.w.introducedAt);
  assert.deepEqual(readV2(s.getItem(STORAGE_KEY)),service.snapshot());
});

for(const failedKey of [FSRS_BACKUP_KEY,STORAGE_KEY])test(`升级写入 ${failedKey} 失败保持原始主记录，可恢复重试`,async()=>{
  const s=store(oldRaw);s.fail=failedKey;
  await assert.rejects(open(s),/Quota/);assert.equal(s.getItem(STORAGE_KEY),oldRaw);
  s.fail=null;const repo=await open(s);assert.equal(repo.snapshot().srs.algorithmVersion,2);
  assert.equal(s.getItem(FSRS_BACKUP_KEY),oldRaw);
});
test('不同备份冲突、坏旧数据和未知算法不会覆盖原数据',async()=>{
  const s=store(oldRaw);s.map.set(FSRS_BACKUP_KEY,'other');
  await assert.rejects(open(s),{code:'BACKUP_CONFLICT'});assert.equal(s.getItem(STORAGE_KEY),oldRaw);
  for(const edit of [s=>{s.srs.algorithmVersion=999;},s=>{s.srs.memories.w.repetition=-1;}]) {
    const value=JSON.parse(oldRaw);edit(value);const raw=JSON.stringify(value),broken=store(raw);
    await assert.rejects(open(broken));assert.equal(broken.getItem(STORAGE_KEY),raw);assert.equal(broken.writes.length,0);
  }
});

test('旧v2只读预览不执行迁移写入，原备份可重新打开再升级',async()=>{
  const s=store(oldRaw),reader=await openLearningStorage(s,{clock:()=>at,timeZone:'UTC',locks:null,readOnly:true});
  assert.equal(reader.writable,false);assert.equal(reader.state.srs.algorithmVersion,2);
  assert.equal(s.writes.length,0);assert.equal(s.getItem(STORAGE_KEY),oldRaw);
  await open(s);const backedUp=s.getItem(FSRS_BACKUP_KEY);
  // Simulate explicit restoration after closing all tabs, using a fresh store.
  const restored=store(backedUp),repo=await open(restored);
  assert.equal(repo.snapshot().srs.algorithmVersion,2);
  assert.equal(restored.getItem(FSRS_BACKUP_KEY),oldRaw);
});

test('FSRS 状态与日志损坏被拒绝；JSON 属性重排不改变语义',()=>{
  const state=createV2State({now:at,timeZone:'UTC'});
  state.srs.memories.w=evaluateMemory(null,event('good'),'UTC').memory;
  for(const edit of [m=>{m.fsrs.difficulty=11;},m=>{m.fsrs.due='invalid';},
    m=>{m.fsrs.stability+=1;},m=>{m.learningHistory[0].fsrsLog.rating=1;},
    m=>{m.learningHistory[0].fsrsLog.scheduled_days+=1;}]) {
    const bad=structuredClone(state);edit(bad.srs.memories.w);assert.throws(()=>validateV2(bad));
  }
  const reordered=structuredClone(state),m=reordered.srs.memories.w;
  for(const key of ['fsrs','fsrsConfig'])m[key]=Object.fromEntries(Object.entries(m[key]).reverse());
  m.learningHistory[0].fsrsLog=Object.fromEntries(Object.entries(m.learningHistory[0].fsrsLog).reverse());
  reordered.srs.fsrsConfig=Object.fromEntries(Object.entries(reordered.srs.fsrsConfig).reverse());
  assert.deepEqual(serializeFSRS(readV2(JSON.stringify(reordered))),serializeFSRS(reordered));
});

test('同一道题先错后尝试改对、并发双击和刷新均只产生一次 Again',async()=>{
  const s=store();let current=at;const repo=await open(s,()=>current);
  const options={clock:()=>current,idFactory:()=>`attempt-${++serial}`};
  let service=createLearningService(repo,data,options);
  await service.startOrdinary([data.words[0]],ordinary);
  const id=service.snapshot().session.sessionId;
  const result=await Promise.all([service.submit({sessionId:id,questionIndex:0,input:'wrong'}),
    service.submit({sessionId:id,questionIndex:0,input:'w'})]);
  assert.deepEqual(result.map(r=>r.accepted),[true,false]);
  service=createLearningService(await open(s,()=>current),data,options);
  assert.equal((await service.submit({sessionId:id,questionIndex:0,input:'w'})).accepted,false);
  let state=service.snapshot();assert.equal(state.srs.memories.w.learningHistory.length,1);
  assert.equal(state.srs.memories.w.learningHistory[0].grade,'again');assert.equal(state.stats.w.correct,0);
  assert.equal(state.mistakes.w.count,1);
  // An explicit later practice is a different event, even on the same day.
  current+=60000;await service.startOrdinary([data.words[0]],ordinary);
  const next=service.snapshot().session.sessionId;
  await service.submit({sessionId:next,questionIndex:0,input:'w'});
  state=service.snapshot();assert.equal(state.srs.memories.w.fsrs.reps,2);
  assert.equal(state.srs.memories.w.learningHistory[1].grade,'good');
  assert.equal(state.daily['2026-11-23'].length,1);assert.equal(state.mistakes.w.count,1);
});

test('每日队列冻结、复习优先补足新词、同日不重复占名额、次日重新选取',async()=>{
  const s=store(),repo=await open(s);let current=at;
  const service=createLearningService(repo,data,{clock:()=>current,random:()=>0,idFactory:()=>`plan-${++serial}`});
  await service.setGoal(2);await service.generate({chapterIds:['1'],mode:'ordered'});
  const original=service.snapshot().srs.dailyPlans['2026-11-23'];
  await service.startPlan('new',{mode:'zh-en'});
  const id=service.snapshot().session.sessionId;
  await service.submit({sessionId:id,questionIndex:0,input:'wrong'});
  assert.deepEqual(service.snapshot().srs.dailyPlans['2026-11-23'].items.map(i=>i.wordId),original.items.map(i=>i.wordId));
  assert.equal(service.overview().todayCount,1);assert.equal(service.overview().counts.completed,1);
  assert.equal(service.overview().backlog,0);
  current+=86400000;await service.settle();
  const tomorrow=service.snapshot().srs.dailyPlans['2026-11-24'];
  assert.deepEqual(tomorrow.items.map(i=>[i.wordId,i.kind]),[['w','review'],['x','new']]);
  assert.equal(service.overview().todayCount,0);assert.equal(service.overview().counts.total,2);
  assert.deepEqual(validateV2(service.snapshot()),readV2(s.getItem(STORAGE_KEY)));
});
