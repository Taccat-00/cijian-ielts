import test from 'node:test';
import assert from 'node:assert/strict';
import { STORAGE_KEY, initialState, dailyCount, studyDate, effectiveGoal } from '../src/core.js';
import { createReviewPersistence } from '../src/persistence.js';
import { createLearningService } from '../src/review/service.js';
import { readV2 } from '../src/review/schema.js';
import { planCounts } from '../src/review/daily-plan.js';

const now=Date.parse('2026-11-20T12:00:00Z');
const dataset={chapters:[{id:'1',name:'A'},{id:'2',name:'B'}],words:Array.from({length:140},(_,i)=>({
  id:i===0?'constructor':`w${i}`,word:i===0?'constructor':`word${i}`,chapters:[i<120?'1':'2'],variants:[i===0?'constructor':`word${i}`],meanings:['词']}))};
const settings={chapterIds:['1'],mode:'ordered'};
const normal={mode:'zh-en',source:'chapter',label:'普通练习',count:'all',timed:false};
function storage(raw=null) {
  const data=new Map(raw===null?[]:[[STORAGE_KEY,raw]]);
  return {fail:false,writes:0,getItem:k=>data.get(k)??null,setItem(k,v){if(this.fail)throw new Error('QuotaExceededError');this.writes++;data.set(k,v);},removeItem:k=>data.delete(k)};
}
async function setup({raw=null,at=now,timeZone='UTC',store=storage(raw),random=()=>.3}={}) {
  const time={at};let id=0;
  const repository=await createReviewPersistence(store,{clock:()=>time.at,timeZone,locks:null,singleTab:true,migrate:true,sessionIdFactory:()=>`old-${++id}`});
  const service=createLearningService(repository,dataset,{clock:()=>time.at,random,idFactory:()=>`session-${++id}`});
  return {store,time,repository,service,state:()=>service.snapshot()};
}
const descriptor=state=>({sessionId:state.session.sessionId,questionIndex:state.session.index});
async function answer(fixture,{correct=true,rating,skip=false}={}) {
  const state=fixture.state(),q=state.session.questions[state.session.index],word=dataset.words.find(w=>w.id===q.wordId);
  if(q.type==='en-zh')await fixture.service.reveal(q.wordId);
  return fixture.service.submit({...descriptor(fixture.state()),input:correct?word.word:'wrong',rating:rating ?? (correct?'correct':'wrong'),skipped:skip});
}

for(const [type,rating,grade,wrong] of [['zh-en',null,'good',false],['zh-en',null,'again',true],['listening',null,'good',false],
  ['en-zh','correct','good',false],['en-zh','fuzzy','hard',true],['en-zh','wrong','again',true]]) {
  test(`${type}/${rating??grade}：业务入口原子提交原成绩、错题、每日、SRS和计划`,async()=>{
    const f=await setup();await f.service.generate(settings);await f.service.startOrdinary([dataset.words[0]],{...normal,mode:type});
    const writes=f.store.writes;await answer(f,{correct:!wrong,rating});
    const state=f.state(),memory=state.srs.memories.constructor;
    // en-zh reveal is its own non-assessment transaction, answer itself one write.
    assert.equal(f.store.writes-writes,type==='en-zh'?2:1);
    assert.equal(memory.dayEvaluation.worstGrade,grade);assert.equal(dailyCount(state,new Date(now)),1);
    assert.equal(planCounts(state.srs.dailyPlans['2026-11-20']).completedNew,1);
    assert.equal(state.stats.constructor.attempts,1);assert.equal(state.session.answers.length,1);
    assert.equal(Boolean(state.mistakes.constructor),wrong);assert.deepEqual(readV2(f.store.getItem(STORAGE_KEY)),state);
  });
}
test('跳过、显示释义、收藏、详情笔记不产生记忆或计划完成',async()=>{
  const f=await setup();await f.service.generate(settings);await f.service.toggleSaved('constructor');await f.service.note('constructor','笔记');
  await f.service.startOrdinary([dataset.words[0]],normal);await answer(f,{skip:true});
  let state=f.state();assert.equal(state.mistakes.constructor.count,1);assert.equal(dailyCount(state,new Date(now)),0);
  assert.equal(state.srs.memories.constructor,undefined);assert.equal(planCounts(state.srs.dailyPlans['2026-11-20']).completed,0);
  await f.service.startOrdinary([dataset.words[0]],{...normal,mode:'en-zh'});await f.service.reveal('constructor');
  assert.equal(f.state().srs.memories.constructor,undefined);
});
test('混合题逐题使用原评分，普通入口不凭空创建每日任务',async()=>{
  const f=await setup();await f.service.startOrdinary(dataset.words.slice(0,3),{...normal,mode:'mixed'});
  const observed=new Set();
  for(let i=0;i<3;i++){observed.add(f.state().session.questions[i].type);await answer(f);await f.service.next();}
  assert.equal(observed.size,3);assert.equal(f.state().session.status,'finished');
  assert.equal(Object.keys(f.state().srs.memories).length,3);assert.equal(Object.keys(f.state().srs.dailyPlans).length,0);
});
test('每日计划保持词序，暂停刷新同范围继续保留当前题、反馈和原题型',async()=>{
  const f=await setup();await f.service.setGoal(3);await f.service.generate({...settings,mode:'random'});
  const original=f.state().srs.dailyPlans['2026-11-20'];await f.service.startPlan('new',{mode:'zh-en'});
  assert.deepEqual(f.state().session.questions.map(q=>q.wordId),original.items.map(i=>i.wordId));
  await answer(f);await f.service.pause();const snapshot=f.state();
  const restored=await setup({store:f.store,random:()=>{throw new Error('已生成计划不能重新随机');}});
  await restored.service.settle();await restored.service.startPlan('new',{mode:'listening'});
  const resumed=restored.state();assert.equal(resumed.session.sessionId,snapshot.session.sessionId);assert.equal(resumed.session.mode,'zh-en');
  assert.equal(resumed.session.answers.length,1);assert.equal(resumed.session.index,0);
  const duplicate=await restored.service.submit({...descriptor(resumed),input:'wrong'});
  assert.equal(duplicate.accepted,false);assert.deepEqual(restored.state().stats,snapshot.stats);
  await restored.service.next();assert.equal(restored.state().session.index,1);
});
test('同词独立练习逐次更新 FSRS，摘要与每日完成仍按词计数',async()=>{
  const f=await setup();await f.service.generate(settings);
  for(const correct of [true,false,true]) {await f.service.startOrdinary([dataset.words[0]],normal);await answer(f,{correct});}
  const state=f.state();assert.equal(state.stats.constructor.attempts,3);assert.equal(state.stats.constructor.correct,2);
  assert.equal(dailyCount(state,new Date(now)),1);assert.equal(planCounts(state.srs.dailyPlans['2026-11-20']).completed,1);
  assert.equal(state.srs.memories.constructor.dayEvaluation.worstGrade,'again');assert.equal(state.srs.memories.constructor.lapseCount,1);
});
test('保存失败不完成答案、不移动题位；同ID重试与并发双击仅保存一次',async()=>{
  const f=await setup();await f.service.generate(settings);await f.service.startPlan('new',{mode:'zh-en'});
  await f.service.draft(f.state().session.sessionId,0,'constructor');const before=f.state(),raw=f.store.getItem(STORAGE_KEY);
  f.store.fail=true;await assert.rejects(answer(f),/Quota/);
  assert.deepEqual(f.state(),before);assert.equal(f.store.getItem(STORAGE_KEY),raw);
  f.store.fail=false;
  const request={...descriptor(before),input:'constructor'};
  const result=await Promise.all([f.service.submit(request),f.service.submit(request)]);
  assert.deepEqual(result.map(r=>r.accepted),[true,false]);assert.equal(f.state().stats.constructor.attempts,1);
});
test('目标和章节/模式变更次日生效，已完成、进行中、已完成计划不重排',async()=>{
  const f=await setup();await f.service.setGoal(2);await f.service.generate(settings);await f.service.startPlan('new');
  await answer(f);await f.service.next();const frozen=JSON.stringify(f.state().srs.dailyPlans['2026-11-20'].items);
  await f.service.configure({goal:3,chapterIds:['2'],mode:'random'});
  assert.equal(effectiveGoal(f.state(),new Date(now)),2);assert.equal(JSON.stringify(f.state().srs.dailyPlans['2026-11-20'].items),frozen);
  await assert.rejects(f.service.startPlan('all'),/未完成/);
  await answer(f);await f.service.next();await f.service.setGoal(4);
  assert.equal(f.state().srs.dailyPlans['2026-11-20'].status,'completed');
  f.time.at+=86400000;await f.service.settle();const plan=f.state().srs.dailyPlans['2026-11-21'];
  assert.equal(plan.goalSnapshot,4);assert.equal(plan.newWordSource.mode,'random');assert.deepEqual(plan.newWordSource.chapterIds,['2']);
  assert.equal(plan.items.filter(i=>i.kind==='review').length,0);assert.equal(plan.items.filter(i=>i.kind==='new').length,4);
});
test('生成前已有普通练习按词去重归类，生成不要求用户重做',async()=>{
  const f=await setup();await f.service.startOrdinary([dataset.words[0]],normal);await answer(f);
  await f.service.setGoal(2);await f.service.generate(settings);
  const plan=f.state().srs.dailyPlans['2026-11-20'];assert.equal(plan.items[0].wordId,'constructor');assert.equal(plan.items[0].kind,'new');assert.equal(plan.items[0].state,'completed');
  await f.service.setGoal(1);await f.service.generate({...settings,mode:'random'});assert.equal(planCounts(f.state().srs.dailyPlans['2026-11-20']).total,2);
});
test('跨午夜在同一答案事务生成今日计划，昨日完成不冒充今日，双计划同步',async()=>{
  const f=await setup({at:Date.parse('2026-12-31T15:59:59Z'),timeZone:'Asia/Shanghai'});
  await f.service.setGoal(2);await f.service.generate(settings);await f.service.startPlan('new',{mode:'zh-en'});const original=f.state().session.sessionId;
  f.time.at=Date.parse('2026-12-31T16:00:01Z');await answer(f);
  const state=f.state();assert.equal(studyDate(state,new Date(f.time.at)),'2027-01-01');assert.equal(state.session.sessionId,original);
  assert.equal(state.srs.dailyPlans['2026-12-31'].status,'archived');
  assert.equal(planCounts(state.srs.dailyPlans['2026-12-31']).completed,1);assert.equal(planCounts(state.srs.dailyPlans['2027-01-01']).completed,1);
  assert.equal(state.daily['2026-12-31'],undefined);assert.deepEqual(state.daily['2027-01-01'],['constructor']);
});
test('多日积压、额外领取、新词不足与原到期日保持',async()=>{
  const old=initialState();old.goal=2;old.daily['2026-11-01']=dataset.words.slice(0,5).map(w=>w.id);
  const f=await setup({raw:JSON.stringify(old)});await f.service.generate({chapterIds:[],mode:'ordered'});
  const before=f.state().srs.memories.constructor.nextReviewAt;assert.equal(f.service.overview().backlog,3);
  await f.service.claimExtra(2);assert.equal(f.service.overview().backlog,1);assert.equal(f.state().srs.dailyPlans['2026-11-20'].extraItems.length,2);
  f.time.at+=3*86400000;await f.service.settle();assert.equal(f.service.overview().counts.review,2);assert.equal(f.service.overview().backlog,3);
  assert.equal(f.state().srs.memories.constructor.nextReviewAt,before);assert.equal(f.service.overview().counts.shortage,0);
});
test('词库临时缩小保留会话和计划，缺失项unavailable，恢复不换词',async()=>{
  const f=await setup();await f.service.setGoal(2);await f.service.generate(settings);await f.service.startPlan('new');
  const frozen=f.state().srs.dailyPlans['2026-11-20'].items.map(i=>i.wordId);
  const reduced=createLearningService(f.repository,{...dataset,words:[]},{clock:()=>f.time.at});
  await reduced.settle();await assert.rejects(reduced.resume(),/缺少/);
  assert.ok(reduced.snapshot().session);assert.equal(reduced.overview().counts.unavailable,2);
  await f.service.settle();assert.deepEqual(f.state().srs.dailyPlans['2026-11-20'].items.map(i=>i.wordId),frozen);
  assert.equal(f.service.overview().counts.unavailable,0);
});
test('过期仓储冲突与revision冲突不覆盖根状态，旧记录完整保留',async()=>{
  const old=initialState();old.saved=['constructor'];old.notes.constructor='旧笔记';old.mistakes.constructor={count:2,lastAt:now};
  const f=await setup({raw:JSON.stringify(old)}),second=await setup({store:f.store});
  const stale=f.state();await f.service.startOrdinary([dataset.words[0]],normal);await answer(f);
  await assert.rejects(second.service.toggleSaved('constructor'),{code:'STORAGE_CONFLICT'});
  await assert.rejects(f.repository.commit(stale),{code:'REVISION_CONFLICT'});
  assert.deepEqual(f.state().saved,old.saved);assert.equal(f.state().notes.constructor,'旧笔记');assert.equal(f.state().mistakes.constructor.count,2);
});
test('固定时区跨夏令时和设备时区改变，学习日与到期日一致',async()=>{
  const f=await setup({at:Date.parse('2026-03-08T06:59:00Z'),timeZone:'America/New_York'});
  await f.service.startOrdinary([dataset.words[0]],normal);f.time.at=Date.parse('2026-03-08T07:01:00Z');await answer(f);
  assert.equal(f.state().srs.memories.constructor.nextReviewAt,'2026-03-11');assert.equal(dailyCount(f.state(),new Date(f.time.at)),1);
  const reopened=await setup({store:f.store,at:f.time.at,timeZone:'Asia/Shanghai'});
  assert.equal(reopened.state().srs.timeZone,'America/New_York');assert.deepEqual(reopened.state().daily,f.state().daily);
});
test('超过30天仅归档计划详情，不删除原daily统计或活动会话',async()=>{
  const f=await setup();await f.service.setGoal(1);await f.service.generate(settings);await f.service.startPlan('new');await answer(f);
  await f.service.startOrdinary([dataset.words[1]],normal);const daily=JSON.stringify(f.state().daily);
  f.time.at+=29*86400000;await f.service.settle();assert.ok(f.state().srs.dailyPlans['2026-11-20']);
  f.time.at+=86400000;await f.service.settle();
  assert.equal(f.state().srs.dailyPlans['2026-11-20'],undefined);assert.equal(f.state().srs.planArchive['2026-11-20'].completed,1);
  assert.equal(JSON.stringify(f.state().daily),daily);assert.ok(f.state().session);
});

test('计划状态随暂停、替换和结束同步，时钟回退不能生成过去计划',async()=>{
  const f=await setup();await f.service.setGoal(2);await f.service.generate(settings);await f.service.startPlan('new');
  const current=()=>f.state().srs.dailyPlans['2026-11-20'];assert.equal(current().status,'active');
  await f.service.pause();assert.equal(current().status,'paused');
  await f.service.startOrdinary([dataset.words[0]],normal);assert.equal(current().status,'ready');
  const raw=f.store.getItem(STORAGE_KEY);f.time.at-=86400000;
  await assert.rejects(f.service.settle(),{code:'CLOCK_ROLLBACK'});assert.equal(f.store.getItem(STORAGE_KEY),raw);
});
test('跨日随机计划只在实际事务抽样一次，后续刷新不再抽样',async()=>{
  let calls=0;const f=await setup({random:()=>{calls++;return .3;}});
  await f.service.setGoal(2);await f.service.generate({...settings,mode:'random'});
  const firstCalls=calls;assert.equal(firstCalls,119);
  f.time.at+=86400000;await f.service.settle();assert.equal(calls-firstCalls,119);
  const frozen=JSON.stringify(f.state().srs.dailyPlans['2026-11-21']);await f.service.settle();
  assert.equal(calls,firstCalls+119);assert.equal(JSON.stringify(f.state().srs.dailyPlans['2026-11-21']),frozen);
});
test('上一轮旧题事件不能为新会话误计分',async()=>{
  const f=await setup();await f.service.startOrdinary([dataset.words[0]],normal);const old=descriptor(f.state());
  await f.service.startOrdinary([dataset.words[1]],normal);const raw=f.store.getItem(STORAGE_KEY);
  await assert.rejects(f.service.submit({...old,input:'constructor'}),{code:'STALE_EVENT'});
  assert.equal(f.store.getItem(STORAGE_KEY),raw);assert.equal(f.state().session.answers.length,0);
});

test('展示查询不写入；移除历史错题和取消收藏不删除记忆',async()=>{
  const f=await setup();await f.service.startOrdinary([dataset.words[0]],normal);await answer(f,{correct:false});
  const memory=structuredClone(f.state().srs.memories.constructor);
  await f.service.toggleSaved('constructor');await f.service.removeMistake('constructor');await f.service.toggleSaved('constructor');
  assert.deepEqual(f.state().srs.memories.constructor,memory);assert.equal(f.state().mistakes.constructor,undefined);assert.deepEqual(f.state().saved,[]);
  const writes=f.store.writes,revision=f.state().revision;
  const options=f.service.configurationOptions(['1']);assert.equal(options.available,119);
  assert.deepEqual(f.service.reviewStates().constructor,{due:false,nextReviewAt:'2026-11-21'});
  f.service.overview();assert.equal(f.store.writes,writes);assert.equal(f.state().revision,revision);
});
