import test from 'node:test';
import assert from 'node:assert/strict';
import { DailyPlanProgress } from '../src/components/Progress.js';
import { DailyPlanSettings, GoalSettings } from '../src/pages/dialogs.js';

test('最小计划入口区分新词复习和积压，目标设置说明次日生效',()=>{
  const plan={dayKey:'2026-11-20',goalSnapshot:100,items:[{wordId:'w',kind:'review',state:'pending'}],extraItems:[]};
  const html=DailyPlanProgress({plan,counts:{review:1,new:0,completedReview:0,completedNew:0,completed:0,total:1,shortage:99,unavailable:0},backlog:3});
  assert.ok(html.includes('复习 0/1'));assert.ok(html.includes('新词 0/0'));assert.ok(html.includes('缺额 99'));assert.ok(html.includes('积压 3'));
  assert.ok(html.includes('data-source="plan"'));
  assert.ok(GoalSettings(200,true).includes('下个学习日生效'));
  const form=DailyPlanSettings({dataset:{chapters:[{id:'1',name:'<script>章节</script>'}]},settings:{chapterIds:['1'],mode:'random'},plan,goal:200,session:null});
  assert.ok(form.includes('name="goal"'));assert.ok(form.includes('value="200"'));assert.ok(form.includes('name="chapters"'));assert.ok(form.includes('value="random" checked'));
  assert.ok(form.includes('&lt;script&gt;章节&lt;/script&gt;'));assert.ok(!form.includes('<script>'));
  assert.ok(form.includes('新设置将从下一个学习日生效'));
});
