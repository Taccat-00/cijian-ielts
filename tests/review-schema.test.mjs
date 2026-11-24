import test from 'node:test';
import assert from 'node:assert/strict';
import { initialState, startSession } from '../src/core.js';
import { createV2State, migrateV1, readV2, validateV2 } from '../src/review/schema.js';
import { evaluateMemory, eventId } from '../src/review/engine.js';

const now=Date.parse('2026-11-20T10:00:00Z');
const config={now,timeZone:'Asia/Shanghai',sessionIdFactory:()=> 'stable-session'};
const v2=()=>createV2State(config);
const roundTrip=value=>readV2(JSON.stringify(value));

test('空白用户创建v2与纯迁移，不触碰输入、不增加今日已练',()=>{
  const old=initialState(), before=JSON.stringify(old), next=migrateV1(old,config);
  assert.equal(next.version,2); assert.equal(next.revision,0);
  assert.equal(next.srs.timeZone,'Asia/Shanghai');
  assert.equal(Object.keys(next.srs.memories).length,0);
  assert.deepEqual(next.daily,old.daily); assert.equal(JSON.stringify(old),before);
  assert.deepEqual(roundTrip(next),next);
});

test('迁移保留收藏错题笔记统计每日记录，会话只补稳定ID不重记答案',()=>{
  const old=initialState();
  old.goal=250; old.saved=['saved-only','constructor','missing'];
  old.notes.constructor='保留'; old.mistakes['skipped-only']={count:1,lastAt:now,lastRating:'wrong'};
  old.stats['skipped-only']={attempts:1,correct:0};
  old.stats['correct-without-daily']={attempts:2,correct:1};
  old.daily['2026-10-01']=['constructor','missing'];
  old.session=startSession([{id:'missing'}],{mode:'zh-en',source:'chapter',label:'旧轮',count:'all'},now);
  const next=migrateV1(old,config);
  for (const key of ['goal','saved','notes','mistakes','stats','daily']) assert.deepEqual(next[key],old[key]);
  assert.deepEqual(next.session,{...old.session,sessionId:'stable-session'});
  assert.deepEqual(next.srs.legacyLearnedIds,['constructor','correct-without-daily','missing']);
  assert.equal(Object.getPrototypeOf(next.srs.memories),null);
  assert.equal(next.srs.memories['saved-only'],undefined); assert.equal(next.srs.memories['skipped-only'],undefined);
  assert.equal(next.srs.memories.toString,undefined);
  for (const m of Object.values(next.srs.memories)) {
    assert.equal(m.origin,'legacy'); assert.equal(m.nextReviewAt,'2026-11-20');
    assert.equal(m.intervalDays,0); assert.equal(m.lastReviewedAt,null); assert.equal(m.introducedAt,null);
    assert.deepEqual(m.learningHistory,[]); assert.equal(m.dayEvaluation,null);
  }
  assert.equal(next.daily['2026-11-20'],undefined);
  assert.deepEqual(roundTrip(next),next);
});

test('v2重复读取不重算日期或阶段，合法新事件和legacy首次评估可恢复',()=>{
  const old=initialState(); old.daily['2026-11-01']=['legacy'];
  const next=migrateV1(old,config);
  for (const wordId of ['legacy','new']) {
    const event={sessionId:'s',questionIndex:0,eventId:eventId('s',0),wordId,grade:'good',type:'zh-en',source:'chapter',at:now};
    next.srs.memories[wordId]=evaluateMemory(next.srs.memories[wordId],event,next.srs.timeZone).memory;
  }
  const restored=roundTrip(next);
  assert.deepEqual(roundTrip(restored),restored);
  assert.equal(restored.srs.memories.legacy.introducedAt,null);
  assert.equal(restored.srs.memories.new.introducedAt,now);
});

test('拒绝坏JSON、高版本和无法安全迁移的v1，不静默丢掉会话',()=>{
  assert.throws(()=>readV2('{'));
  assert.throws(()=>readV2(JSON.stringify({...v2(),version:3})),/版本/);
  for (const edit of [s=>{s.session={};},s=>{s.saved=[1];},s=>{s.daily['2026-02-30']=['w'];},s=>{s.stats.w={attempts:-1,correct:0};}]) {
    const old=initialState(); edit(old); const before=JSON.stringify(old);
    assert.throws(()=>migrateV1(old,config)); assert.equal(JSON.stringify(old),before);
  }
});

test('v2校验拒绝非法字段、阶段、时区、日历、历史、基线与调度伪造',()=>{
  const valid=v2();
  valid.srs.memories.word=evaluateMemory(null,{sessionId:'s',questionIndex:0,eventId:eventId('s',0),
    wordId:'word',type:'en-zh',source:'chapter',grade:'good',at:now},config.timeZone).memory;
  const edits=[s=>{s.revision=-1;},s=>{s.srs.timeZone='Mars/Base';},s=>{s.srs.algorithmVersion=999;},
    s=>{s.srs.memories.word.status='mastered';},s=>{s.srs.memories.word.wordId='other';},
    s=>{s.srs.memories.word.nextReviewAt='2026-02-29';},s=>{s.srs.memories.word.nextReviewAt='2026-12-31';},
    s=>{s.srs.memories.word.repetition=5;},s=>{s.srs.memories.word.learningHistory[0].eventId='wrong';},
    s=>{s.srs.memories.word.learningHistory[0].dayKey='2026-11-19';},s=>{s.srs.memories.word.learningHistory=[];},
    s=>{s.srs.memories.word.dayEvaluation.eventIds=[];},s=>{s.srs.memories.word.dayEvaluation.firstIntroduction=false;},
    s=>{s.srs.memories.word.historySummary.count=1;},s=>{s.srs.memories.word.lapseCount=Infinity;},
    s=>{s.srs.legacyLearnedIds=['unknown'];}];
  for (const edit of edits) {const bad=structuredClone(valid);edit(bad);assert.throws(()=>validateV2(bad));}
});

test('仅校验计划快照结构和全局去重，不生成每日计划',()=>{
  const state=v2(), day='2026-11-20';
  state.srs.dailyPlans[day]={planId:'plan',dayKey:day,timeZone:config.timeZone,generatedAt:now,updatedAt:now,
    algorithmVersion:1,datasetRevision:'words-v1',goalSnapshot:100,newWordSource:{chapterIds:['1'],mode:'ordered'},
    items:[{wordId:'a',kind:'review',state:'pending'}],extraItems:[{wordId:'b',kind:'review',state:'completed'}],status:'ready'};
  assert.deepEqual(roundTrip(state),state);
  for (const edit of [p=>{p.extraItems[0].wordId='a';},p=>{p.extraItems[0].kind='new';},p=>{p.timeZone='UTC';},
    p=>{p.goalSnapshot=0;},p=>{p.newWordSource.chapterIds=['1','1'];},p=>{p.dayKey='2026-11-21';}]) {
    const bad=structuredClone(state);edit(bad.srs.dailyPlans[day]);assert.throws(()=>validateV2(bad));
  }
});

test('含 __proto__ 的词ID安全往返，稀疏数组不被悄悄存成null',()=>{
  const old=JSON.parse(JSON.stringify(initialState()));
  old.daily['2026-11-19']=['__proto__'];
  old.notes=JSON.parse('{"__proto__":"原样保留"}');
  const state=migrateV1(old,config),restored=roundTrip(state);
  assert.equal(Object.getPrototypeOf(restored.notes),null);
  assert.equal(restored.notes.__proto__,'原样保留');
  assert.equal(restored.srs.memories.__proto__.wordId,'__proto__');
  assert.equal({}.polluted,undefined);
  const broken=v2();broken.saved=new Array(1);assert.throws(()=>validateV2(broken));
});
