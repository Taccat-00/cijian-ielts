import test from 'node:test';
import assert from 'node:assert/strict';
import { WordItem } from '../src/components/WordItem.js';
import { DailyPlanPage, planContentSelection } from '../src/pages/DailyPlanPage.js';

const word={id:'r-1',word:'secretanswer',phonetic:'/secret-phonetic/',pos:'secret-pos',meanings:['隐藏的释义'],chapters:['1']};
const dataset={chapters:[{id:'1',name:'自然地理'}],words:[word]};
const plan={goalSnapshot:1,newWordSource:{chapterIds:['1'],mode:'ordered'},items:[{wordId:'r-1',kind:'review',state:'pending'}],extraItems:[]};
const overview={day:'2026-11-20',plan,counts:{total:1,completed:0,review:1,new:0,completedReview:0,completedNew:0,pendingReview:1,pendingNew:0,pendingExtra:0,extra:0,shortage:0,unavailable:0},todayCount:0,backlog:0};
const render=(options={})=>DailyPlanPage({overview,dataset,goal:1,...options});

test('复习预览从可见内容、辅助标签和音频入口中移除所有答案',()=>{
 const html=WordItem({word,source:'plan',concealed:true,previewLabel:'复习词 01',saved:true});
 for(const answer of [word.word,word.phonetic,word.pos,...word.meanings])assert.ok(!html.includes(answer));
 assert.ok(!html.includes('data-action="speak"'));assert.ok(!html.includes('data-action="detail"'));
 assert.ok(html.includes('data-action="reveal-plan-word"'));assert.ok(html.includes('已加入生词本：复习词 01（点击移出）'));
});
test('未完成复习默认显示完整词卡，重复渲染不改变计划或进度',()=>{
 const before=JSON.stringify(plan),html=render();
 for(const answer of [word.word,word.phonetic,...word.meanings])assert.ok(html.includes(answer));
 assert.ok(html.includes('data-action="detail"'));assert.ok(html.includes('data-action="speak"'));
 assert.ok(!html.includes('reveal-plan-word'));assert.ok(!html.includes('全部隐藏'));
 assert.ok(html.includes('aria-valuenow="0"'));assert.equal(render(),html);
 assert.equal(JSON.stringify(plan),before);
 const ordinary=WordItem({word});assert.ok(ordinary.includes(word.word));assert.ok(!ordinary.includes('reveal-plan-word'));
});
test('预览最多3词，展开后每页12词，完整计划可遍历且完成词不丢失',()=>{
 const items=Array.from({length:31},(_,i)=>({wordId:`id-${i}`,kind:'new',state:i%4===0?'completed':'pending'}));
 const source={items},before=JSON.stringify(source),preview=planContentSelection(source,'new');
 assert.equal(preview.items.length,3);assert.ok(preview.items.every(i=>i.state==='pending'));
 assert.equal(planContentSelection(source,'new',{previewSize:4}).items.length,4);
 const seen=[];
 for(let page=0;page<3;page++) {
   const selected=planContentSelection(source,'new',{scope:'all',expanded:true,page});
   assert.ok(selected.items.length<=12);seen.push(...selected.items);
 }
 assert.equal(new Set(seen.map(i=>i.wordId)).size,31);
 assert.deepEqual(seen,[...items.filter(i=>i.state!=='completed'),...items.filter(i=>i.state==='completed')]);
 assert.equal(JSON.stringify(source),before);
});
test('已完成复习在查看已学时直接展开，不再逐词揭示',()=>{
 const finishedPlan={...plan,items:[{...plan.items[0],state:'completed'}]};
 const finished={...overview,plan:finishedPlan,counts:{...overview.counts,completed:1,completedReview:1,pendingReview:0},todayCount:1};
 const html=DailyPlanPage({overview:finished,dataset,goal:1});
 assert.ok(html.includes('本组已完成'));assert.ok(html.includes('查看已学 1 词'));assert.ok(!html.includes('data-word-id='));
 const all=DailyPlanPage({overview:finished,dataset,goal:1,contentState:{review:{scope:'all',expanded:true}}});
 assert.ok(all.includes('data-word-id="r-1"'));assert.ok(all.includes(word.word));assert.ok(all.includes(word.phonetic));assert.ok(all.includes(word.meanings[0]));assert.ok(all.includes('已完成</span>'));
 assert.ok(!all.includes('data-action="reveal-plan-word"'));
 assert.ok(!DailyPlanPage({overview:finished,dataset,goal:1,contentState:{review:{scope:'all',expanded:true},revealed:new Set([word.id])}}).includes('全部隐藏'));
});
test('新词复用完整WordItem，词库缺失项保留位置和计划分母',()=>{
 const newPlan={...plan,items:[{wordId:word.id,kind:'new',state:'pending'},{wordId:'missing',kind:'new',state:'unavailable'}]};
 const before=JSON.stringify(newPlan);
 const html=DailyPlanPage({overview:{...overview,plan:newPlan,counts:{...overview.counts,total:2,review:0,new:2,pendingReview:0,pendingNew:1,unavailable:1}},dataset,goal:2});
 assert.ok(html.includes(word.word));assert.ok(html.includes(word.phonetic));assert.ok(html.includes(word.meanings[0]));
 assert.ok(html.includes('词条暂不可用'));assert.ok(html.includes('实际安排2词'));assert.equal(JSON.stringify(newPlan),before);
});
test('分页在完成状态变化后收敛到合法页，不填入词库中计划外的词',()=>{
 const selection=planContentSelection(plan,'review',{scope:'all',expanded:true,page:50});
 assert.equal(selection.page,0);assert.deepEqual(selection.items,plan.items);
 const html=render({dataset:{...dataset,words:[word,{...word,id:'outside',word:'outsidesecret'}]}});
 assert.ok(!html.includes('outsidesecret'));assert.ok(!html.includes('data-word-id="outside"'));
});
test('只读时完整词卡仍可浏览，学习写入保持禁用',()=>{
 const html=render({writable:false});
 assert.ok(!html.includes('data-action="reveal-plan-word"'));
 assert.match(html,/data-action="start-plan"[^>]*disabled/);
 // The application applies its existing reflectAccess gate to shared bookmark controls.
 assert.ok(html.includes('data-action="save-word"'));assert.ok(html.includes(word.word));
});
