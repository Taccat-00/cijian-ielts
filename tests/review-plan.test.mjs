import test from 'node:test';
import assert from 'node:assert/strict';
import { createV2State } from '../src/review/schema.js';
import { generateDailyPlan, dueWords, planCounts, extraReviewCandidates } from '../src/review/daily-plan.js';

const now=Date.parse('2026-11-20T12:00:00Z'),day='2026-11-20';
const dataset={chapters:[{id:'1',name:'A'},{id:'2',name:'B'}],words:Array.from({length:350},(_,i)=>({
  id:`w${String(i).padStart(3,'0')}`,word:`w${i}`,chapters:[i<300?'1':'2'],variants:[],meanings:['词']}))};
const options={now,settings:{chapterIds:['1'],mode:'ordered'}};
function stateWithDue(count) {
  const state=createV2State({now,timeZone:'UTC'});
  for(const word of dataset.words.slice(0,count))state.srs.memories[word.id]={wordId:word.id,nextReviewAt:day,lapseCount:0,origin:'legacy'};
  return state;
}
for(const count of [0,20,50,80,100,120])test(`到期${count}词时按目标100优先复习，其余补新词`,()=>{
  const state=stateWithDue(count),before=JSON.stringify(state),plan=generateDailyPlan(state,dataset,options),counts=planCounts(plan);
  assert.equal(counts.review,Math.min(count,100));assert.equal(counts.new,100-Math.min(count,100));
  assert.equal(new Set(plan.items.map(i=>i.wordId)).size,100);assert.equal(JSON.stringify(state),before);
  state.srs.dailyPlans[day]=plan;assert.equal(extraReviewCandidates(state,dataset,day).length,Math.max(0,count-100));
});
test('目标与100解耦、新词不足、空词库与空章节不填入其他章',()=>{
  const state=stateWithDue(20);state.goal=25;
  assert.equal(planCounts(generateDailyPlan(state,dataset,options)).new,5);
  const small={...dataset,words:dataset.words.slice(0,30)};
  const counts=planCounts(generateDailyPlan(state,small,options));assert.equal(counts.review,20);assert.equal(counts.new,5);assert.equal(counts.shortage,0);
  state.goal=100;assert.equal(planCounts(generateDailyPlan(state,small,options)).shortage,70);
  assert.equal(generateDailyPlan(state,{chapters:[],words:[]},{now,settings:{chapterIds:[],mode:'ordered'}}).items.length,0);
  assert.equal(planCounts(generateDailyPlan(state,dataset,{now,settings:{chapterIds:[],mode:'ordered'}})).new,0);
  assert.throws(()=>generateDailyPlan(state,dataset,{now,settings:{chapterIds:['unknown'],mode:'ordered'}}));
});
test('多章重叠与重复ID按词库原始顺序去重，排除已学、迁移与已练词',()=>{
  const state=stateWithDue(1);state.goal=5;
  state.srs.legacyLearnedIds=['w002'];state.daily[day]=['w003'];
  const duplicate={...dataset,words:[...dataset.words,{...dataset.words[1],chapters:['2']}]};
  const plan=generateDailyPlan(state,duplicate,{now,settings:{chapterIds:['2','1'],mode:'ordered'}});
  assert.deepEqual(plan.items.map(i=>i.wordId),['w003','w000','w001','w004','w005']);
  assert.equal(plan.items[0].state,'completed');assert.equal(new Set(plan.items.map(i=>i.wordId)).size,5);
  const chapter2=generateDailyPlan(state,duplicate,{now,settings:{chapterIds:['2'],mode:'ordered'}});
  assert.ok(chapter2.items.some(i=>i.wordId==='w001'));
});
test('随机无放回且当天快照稳定，刷新和重复生成不调用随机数',()=>{
  const state=stateWithDue(20);let calls=0;
  const plan=generateDailyPlan(state,dataset,{...options,settings:{chapterIds:['1'],mode:'random'},random:()=>{calls++;return .25;}});
  assert.ok(calls>0);assert.equal(new Set(plan.items.map(i=>i.wordId)).size,100);
  const restored=JSON.parse(JSON.stringify(state));restored.srs.dailyPlans[day]=JSON.parse(JSON.stringify(plan));
  const again=generateDailyPlan(restored,dataset,{...options,random:()=>{throw new Error('不应重新抽样');}});
  assert.deepEqual(again,plan);
});
test('到期按日期、遗忘次数、ID确定排序，积压保持原日期与记忆',()=>{
  const state=stateWithDue(4);state.goal=2;
  state.srs.memories.w000.nextReviewAt='2026-11-19';state.srs.memories.w001.nextReviewAt='2026-11-18';
  state.srs.memories.w002.nextReviewAt='2026-11-18';state.srs.memories.w002.lapseCount=2;
  assert.deepEqual(dueWords(state,dataset,day).map(m=>m.wordId),['w002','w001','w000','w003']);
  const before=JSON.stringify(state.srs.memories);const plan=generateDailyPlan(state,dataset,options);
  assert.deepEqual(plan.items.map(i=>i.wordId),['w002','w001']);assert.equal(JSON.stringify(state.srs.memories),before);
});
