import test from 'node:test';
import assert from 'node:assert/strict';
import { FilterTabs } from '../src/components/controls.js';
import { WordItem } from '../src/components/WordItem.js';

test('分段筛选只含一个高亮，初始位置和两项生词本页面与原筛选ID一致',()=>{
 const html=FilterTabs('saved','chapter');
 assert.equal((html.match(/class="filter-highlight"/g)||[]).length,1);
 assert.ok(html.includes('--filter-count:3;--filter-index:2'));
 assert.ok(html.includes('role="group" aria-label="词汇筛选"'));
 assert.match(html,/data-id="saved" aria-pressed="true"[^>]*>生词本/);
 assert.ok(!html.includes('已收藏'));
 const saved=FilterTabs('unpracticed','saved');
 assert.ok(saved.includes('--filter-count:2;--filter-index:1'));
 assert.ok(!saved.includes('data-id="saved"'));
});
test('生词本词卡的名称、提示和按下状态同时表达已加入及可移出',()=>{
 const word={id:'w',word:'word',pos:'n.',meanings:['词']};
 const html=WordItem({word,saved:true});
 assert.ok(html.includes('aria-label="已加入生词本：word（点击移出）"'));
 assert.ok(html.includes('title="已加入生词本：word（点击移出）"'));
 assert.ok(html.includes('aria-pressed="true"'));
 assert.ok(WordItem({word,saved:false}).includes('title="加入生词本：word"'));
});
