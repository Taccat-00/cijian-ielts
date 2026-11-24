import test from 'node:test';
import assert from 'node:assert/strict';
import { VocabularyPage, VocabularyWords } from '../src/pages/VocabularyPage.js';
import { PracticePage } from '../src/pages/PracticePage.js';
import { ResultsPage } from '../src/pages/ResultsPage.js';

const word={id:'test',word:'atmosphere',meanings:['大气'],phonetic:'/test/',pos:'n.',variants:['atmosphere']};
const counts={correct:0,wrong:0,fuzzy:0};
const session={label:'自然地理',mode:'zh-en',source:'chapter',questions:[{wordId:'test',type:'zh-en'}],answers:[],index:0,status:'active',timed:false,draft:'draft',revealed:false};
test('收藏与错题复用同一词卡结构，保留移除、发音、详情和真实错题次数',()=>{
 for(const source of ['saved','mistakes']) {
  const page=VocabularyPage({source,title:'我的词汇',count:1,goal:'UNUSED_GOAL',session:null,search:'',filter:'all'});
  assert.equal((page.match(/id="library-heading"/g)||[]).length,1);
  assert.ok(!page.includes('UNUSED_GOAL'));
  const cards=VocabularyWords({words:[word],source,savedIds:new Set(['test']),today:new Set(),notes:{},mistakes:{test:{count:3}},search:'',filter:'all'});
  for(const hook of ['word-card-body','word-actions','word-translation','data-action="speak"','data-action="detail"','aria-pressed="true"']) assert.ok(cards.includes(hook));
  if(source==='mistakes') { assert.ok(cards.includes('收录 3 次')); assert.ok(cards.includes('data-action="remove-mistake"')); }
 }
});
test('三个题型和暂停状态保留输入、回忆评价、听音及恢复操作',()=>{
 for(const type of ['zh-en','en-zh','listening']) {
  const s={...session,questions:[{wordId:'test',type}]};
  const html=PracticePage({session:s,word,counts,hasRecall:type==='en-zh',remaining:0,goal:'',saved:false});
  assert.ok(html.includes('practice-status'));
  assert.ok(html.includes('practice-workspace'));
  if(type==='en-zh') assert.ok(html.includes('id="reveal-meaning"'));
  else { assert.ok(html.includes('id="answer-form"')); assert.ok(html.includes('value="draft"')); }
  if(type==='listening') assert.ok(html.includes('aria-label="播放本题单词"'));
  const paused=PracticePage({session:{...s,status:'paused'},word,counts,remaining:0,goal:'',saved:false});
  assert.ok(paused.includes('data-action="pause"')); assert.ok(!paused.includes('id="answer-input"'));
 }
 const revealed=PracticePage({session:{...session,revealed:true,questions:[{wordId:'test',type:'en-zh'}]},word,counts,hasRecall:true,remaining:0,goal:'',saved:false});
 for(const rating of ['correct','fuzzy','wrong']) assert.ok(revealed.includes(`data-rating="${rating}"`));
});
test('结果正确率只统计已回答题目，保留错题回顾和复习入口',()=>{
 const answers=[{wordId:'test',correct:true},{wordId:'test',correct:false,input:'wrong'}];
 const html=ResultsPage({session:{...session,questions:[{}, {}, {}],answers,reason:'completed'},counts:{correct:1,wrong:1,fuzzy:0},hasRecall:false,wordMap:new Map([['test',word]]),dailyCount:2,goal:100});
 assert.ok(html.includes('<strong>50%</strong>'));
 assert.ok(html.includes('未答 1 题'));
 assert.ok(html.includes('data-action="review-round"'));
 assert.ok(html.includes('data-action="leave-practice"'));
});
