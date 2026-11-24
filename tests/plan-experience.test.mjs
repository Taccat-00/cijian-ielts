import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DailyPlanPage } from '../src/pages/DailyPlanPage.js';
import { DailyPlanSettings, PlanPracticeSettings } from '../src/pages/dialogs.js';
import { StorageNotice } from '../src/components/StorageNotice.js';
import { AppShell } from '../src/components/AppShell.js';
import { WordItem } from '../src/components/WordItem.js';
import { createV2State } from '../src/review/schema.js';
import { generateDailyPlan, dailyOverview } from '../src/review/daily-plan.js';
import { planConfigurationOptions, wordReviewStates } from '../src/review/service.js';

const now=Date.parse('2026-11-20T04:00:00Z');
const dataset={chapters:[{id:'1',name:'自然地理'},{id:'2',name:'植物研究'}],words:[
 {id:'a',word:'alpha',chapters:['1','2'],meanings:['一'],variants:['alpha'],pos:'n.'},
 {id:'b',word:'beta',chapters:['1'],meanings:['二'],variants:['beta'],pos:'n.'}
]};
function fixture() {
 const state=createV2State({now,timeZone:'Asia/Shanghai'});
 state.srs.dailyPlans['2026-11-20']=generateDailyPlan(state,dataset,{now,settings:{chapterIds:['1'],mode:'random'},random:()=>.5});
 return state;
}
const render=(state,options={})=>DailyPlanPage({overview:dailyOverview(state,dataset,now),dataset,session:state.session,goal:state.goal,...options});

test('每日计划区分目标100与实际2词，不用大统计卡或静态填满目标',()=>{
 const html=render(fixture());
 assert.ok(html.includes('<summary>计划详情 · 未满目标</summary>'));
 assert.ok(html.includes('实际安排</dt><dd>2 词'));assert.ok(html.includes('未补入其他章节'));
 assert.ok(html.includes('class="plan-remaining"><strong>2</strong>'));assert.ok(html.includes('aria-label="基础计划完成进度"'));
 assert.ok(!html.includes('plan-facts'));assert.ok(!html.includes('plan-progress-key'));
 assert.ok(!html.includes('调整从下一个学习日生效'));
 assert.ok(html.includes('调整新词来源与选词方式'));
 assert.ok(html.includes('已完成 0，安排 2 词'));
 assert.ok(!html.includes('词待完成'));assert.ok(!html.includes('默认隐藏词与释义'));
 assert.ok(html.includes('缺额</dt><dd>98 词'));
 assert.ok(html.includes('今日目标</dt><dd>100 词'));
 assert.equal((html.match(/class="button primary/g)||[]).length,1);
 assert.ok(html.includes('word-grid plan-word-grid'));assert.ok(!html.includes('class="plan-task"'));
});
test('未生成、未选来源、无到期词及零任务状态不伪装完成',()=>{
 const state=createV2State({now,timeZone:'UTC'});
 assert.ok(render(state).includes('设置今日计划'));
 state.srs.dailyPlans['2026-11-20']=generateDailyPlan(state,dataset,{now,settings:{chapterIds:[],mode:'ordered'}});
 const html=render(state);assert.ok(html.includes('暂无可安排词汇'));assert.ok(!html.includes('今日基础任务已完成'));
 assert.ok(html.includes('尚未选择新词章节'));assert.ok(html.includes('暂无到期复习'));
 assert.ok(!html.includes('class="button primary'));
});
test('部分不可用与完成状态文字可辨，按钮不会误导启动缺失任务',()=>{
 const state=fixture(),plan=state.srs.dailyPlans['2026-11-20'];
 plan.items.forEach(i=>{i.state='unavailable';});
 let html=render(state);assert.ok(html.includes('任务暂不可用'));assert.ok(html.includes('2 个任务词暂不可用'));assert.ok(html.includes('重新加载词库'));
 assert.ok(!html.includes('class="button primary'));
 plan.items.forEach(i=>{i.state='completed';});html=render(state);
 assert.ok(html.includes('class="plan-remaining"><strong>0</strong>'));assert.ok(html.includes('今日计划已完成'));
});
test('未完成会话成为单一主操作，额外复习不会改写基础分母',()=>{
 const state=fixture(),plan=state.srs.dailyPlans['2026-11-20'];
 state.session={status:'paused',label:'原练习',answers:[],questions:[{}]};
 plan.extraItems=[{wordId:'extra',kind:'review',state:'pending'}];
 const html=render(state);
 assert.ok(html.includes('继续未完成练习'));assert.equal((html.match(/class="button primary/g)||[]).length,1);
 assert.ok(html.includes('不计入上方计划进度'));assert.ok(html.includes('实际安排</dt><dd>2 词'));
});
test('只读展示禁止主学习动作，仍能看到真实计划与进度',()=>{
 const html=render(fixture(),{writable:false});
 assert.match(html,/data-action="start-plan"[^>]*disabled/);
 assert.ok(html.includes('基础计划完成进度'));assert.ok(html.includes('自然地理'));
 const notice=StorageNotice({message:'其他页面正在使用',readOnly:true,retry:true});
 assert.ok(notice.includes('只读浏览'));assert.ok(notice.includes('重新加载'));assert.ok(!notice.includes('重试保存'));
});
test('计划外去重词数独立呈现，不改写主进度或任务分母',()=>{
 const state=fixture(),plan=state.srs.dailyPlans['2026-11-20'];
 plan.items[0].state='completed';
 state.daily['2026-11-20']=['a','outside'];
 const html=render(state);
 assert.ok(html.includes('基础计划已练1词，实际安排2词'));
 assert.ok(html.includes('今日已练</dt><dd>2 个不同单词'));
 assert.ok(html.includes('实际安排</dt><dd>2 词'));
 assert.ok(html.includes('已完成 1，安排 2 词'));
 state.daily['2026-11-20']=['a'];
 const sameCount=render(state);
 assert.ok(sameCount.includes('<summary>计划详情 · 未满目标</summary>'));
 assert.ok(sameCount.includes('今日已练</dt><dd>1 个不同单词'));
});
test('来源摘要安全转义，收起缺额信息不改变计划或隐藏缺额数量',()=>{
 const state=fixture(),before=JSON.stringify(state);
 const html=render(state,{dataset:{...dataset,chapters:[{id:'1',name:'<script>来源</script>'}]}});
 assert.ok(html.includes('&lt;script&gt;来源&lt;/script&gt;'));
 assert.ok(!html.includes('<script>'));
 assert.ok(html.includes('<details class="plan-details"><summary>计划详情 · 未满目标'));
 assert.equal(JSON.stringify(state),before);
});
test('保存失败有重试入口，冲突引导重新加载且安全转义错误内容',()=>{
 assert.ok(StorageNotice({message:'容量不足',retry:true}).includes('data-action="retry-save"'));
 const conflict=StorageNotice({message:'<script>bad</script>',conflict:true,retry:true});
 assert.ok(conflict.includes('&lt;script&gt;'));assert.ok(!conflict.includes('<script>'));
 assert.ok(conflict.includes('重新加载'));assert.ok(!conflict.includes('重试保存'));
});
test('配置使用原目标和原生radio/checkbox，来源计数按词ID合并',()=>{
 const state=fixture(),options=planConfigurationOptions(state,dataset,now,['1','2']);
 assert.equal(options.available,2);assert.equal(options.chapters[0].available,2);assert.equal(options.chapters[1].available,1);
 const html=DailyPlanSettings({dataset,settings:{chapterIds:['1','2'],mode:'random'},plan:state.srs.dailyPlans['2026-11-20'],goal:150,configuration:options});
 assert.ok(html.includes('name="goal"'));assert.ok(html.includes('value="150"'));
 assert.ok(html.includes('min="1" max="2000"'));assert.ok(html.includes('type="radio" name="selection" value="random" checked'));
 assert.ok(html.includes('已选 2 章 · 未学 2 词'));assert.ok(html.includes('新设置将从下一个学习日生效'));
});
test('开始练习前选题型，替换未完成会话必须有清晰说明',()=>{
 const html=PlanPracticeSettings({kind:'review',hasUnfinished:true});
 assert.ok(html.includes('替换当前未完成的练习'));assert.ok(html.includes('替换并开始'));
 for(const mode of ['zh-en','en-zh','listening','mixed'])assert.ok(html.includes(`value="${mode}"`));
});
test('每日计划导航独立且唯一，章节与原品牌保留',()=>{
 const shell=AppShell({dataset,source:'plan',chapterId:'1',chapterCounts:new Map([['1',2],['2',1]]),mistakesCount:0,savedCount:0});
 assert.equal((shell.match(/data-source="plan"/g)||[]).length,1);
 assert.match(shell,/nav-item active[^>]*aria-current="page"[^>]*data-source="plan"/);
 assert.ok(shell.includes('brand-logo-transparent.png'));assert.ok(shell.includes('aria-label="词书章节"'));
});
test('收藏和错题的复习文字只来自记忆，章节词卡保持原视觉结构',()=>{
 const word=dataset.words[0];
 const card=WordItem({word,source:'saved',saved:true,review:{due:true,nextReviewAt:'2026-11-20'}});
 assert.ok(card.includes('已到期，可复习'));assert.ok(card.includes('data-action="save-word"'));
 assert.ok(WordItem({word,source:'mistakes',review:{due:false,nextReviewAt:'2026-11-23'}}).includes('下次复习 2026-11-23'));
 assert.ok(!WordItem({word,source:'chapter',review:{due:true}}).includes('word-review-info'));
 assert.ok(!WordItem({word,source:'saved'}).includes('已掌握'));
 const state=fixture(),before=JSON.stringify(state);assert.deepEqual(Object.keys(wordReviewStates(state,now)),[]);assert.equal(JSON.stringify(state),before);
});
test('新增样式复用tokens，四档响应式与减少动画策略保留',async()=>{
 const css=await readFile(new URL('../src/styles/plan.css',import.meta.url),'utf8');
 assert.ok(css.includes('var(--home-divider)'));assert.ok(css.includes('var(--home-shadow-glass)'));
 assert.ok(css.includes('@media(max-width:1100px)'));assert.ok(css.includes('@media(max-width:900px)'));assert.ok(css.includes('@media(max-width:640px)'));
 assert.ok(css.includes('@media(prefers-reduced-motion:reduce)'));
 assert.ok(!css.includes('scale('));
});
