import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { posix } from 'node:path';
import { PUBLIC_FILES } from '../scripts/public-files.mjs';
import { WordItem } from '../src/components/WordItem.js';
import { WordDetails } from '../src/pages/dialogs.js';
import { VocabularyPage } from '../src/pages/VocabularyPage.js';

test('组件拆分后，全部模块与 CSS 依赖都在公开清单中且没有循环依赖', async () => {
  const graph = new Map();
  for (const file of PUBLIC_FILES.filter(file => /\.(js|css)$/.test(file))) {
    const source = await readFile(new URL('../' + file, import.meta.url), 'utf8');
    const imports = [...source.matchAll(/(?:from\s+|@import\s+)["']([^"']+)["']/g)].map(match => match[1]);
    const targets = imports.map(specifier => {
      assert.ok(specifier.startsWith('.'), `${file}: unexpected dependency ${specifier}`);
      const target = posix.normalize(posix.join(posix.dirname(file), specifier));
      assert.ok(PUBLIC_FILES.includes(target), `${file}: missing public dependency ${target}`);
      return target;
    });
    graph.set(file, targets);
  }
  const visited = new Set();
  function visit(file, active = new Set()) {
    assert.ok(!active.has(file), `circular dependency: ${file}`);
    if (visited.has(file)) return;
    const next = new Set(active).add(file);
    for (const target of graph.get(file) || []) visit(target, next);
    visited.add(file);
  }
  for (const file of graph.keys()) visit(file);
});

test('词卡与详情安全转义真实数据，同时保留独立详情、发音、收藏与笔记入口', () => {
  const word = { id:'w"1', word:'A&B <img src=x>', phonetic:'/test/', pos:'n.', meanings:['<script>meaning</script>'], variants:['A&B'], chapters:['1'], example:'An example.', translation:'例句', memory:'' };
  const card = WordItem({word, saved:true, practiced:true, note:'note'});
  assert.ok(card.includes('A&amp;B &lt;img src=x&gt;'));
  assert.ok(card.includes('&lt;script&gt;meaning&lt;/script&gt;'));
  assert.ok(!card.includes('<script>'));
  for (const action of ['detail','speak','save-word']) assert.ok(card.includes(`data-action="${action}"`));
  assert.ok(card.includes('aria-pressed="true"'));
  assert.ok(card.includes('今日已练'));
  const detail = WordDetails({word, chapterName:'A&B', note:'</textarea><script>bad</script>', saved:false});
  assert.ok(detail.includes('&lt;/textarea&gt;&lt;script&gt;bad&lt;/script&gt;'));
  assert.ok(!detail.includes('<script>'));
  assert.ok(detail.includes('id="word-note"'));
});

test('页面标题只转义一次，练习入口与未完成状态保持可访问', () => {
  const html = VocabularyPage({source:'chapter', title:'A&B', count:12, goal:'', session:null, search:'', filter:'all'});
  assert.ok(html.includes('A&amp;B'));
  assert.ok(!html.includes('A&amp;amp;B'));
  assert.ok(html.includes('data-multi="true"'));
  assert.ok(html.includes('aria-label="搜索单词或释义"'));
  assert.ok(!html.includes('resume-banner'));
  assert.equal((html.match(/id="library-heading"/g) || []).length, 1);
  assert.match(html, /<h1 id="library-heading">A&amp;B <span class="count-label">12 词<\/span><\/h1>/);
  assert.ok(!html.includes('雅思词汇学习'));
  assert.ok(!html.includes('chapter-intro'));
  assert.match(html, /library-toolbar[\s\S]*section-actions[\s\S]*data-multi="true"/);
});
