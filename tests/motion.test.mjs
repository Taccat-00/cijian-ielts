import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

const source = await readFile(new URL('../src/motion.js', import.meta.url), 'utf8');
const tokens = await readFile(new URL('../src/styles/tokens.css', import.meta.url), 'utf8');

function environment() {
  let changePreference;
  const preference = { matches:false, addEventListener:(_, listener) => { changePreference = listener; } };
  const effects = [];
  const elements = new Map();
  const element = name => {
    const node = { name, animate(frames, options) {
      let resolve, reject;
      const finished = new Promise((yes, no) => { resolve = yes; reject = no; });
      const effect = { node, frames, options, finished, cancelled:false,
        cancel() { this.cancelled = true; reject(new Error('cancelled')); }, finish:resolve };
      effects.push(effect);
      return effect;
    }};
    return node;
  };
  for (const name of ['.vocabulary-home','.welcome-copy','.daily-goal','.resume-banner','.library-toolbar','#word-grid']) elements.set(name, element(name));
  const root = { querySelector:selector => elements.get(selector) || null };
  const context = {
    window:{matchMedia:() => preference}, Element:{prototype:{animate() {}}},
    document:{documentElement:{}, querySelector:root.querySelector},
    getComputedStyle:() => ({getPropertyValue:name => tokens.match(new RegExp(`${name}:([^;]+);`))?.[1] || ''})
  };
  runInNewContext(source.replace('export const motion =', 'globalThis.motion ='), context);
  return { motion:context.motion, root, effects, elements, element,
    reduce() { preference.matches = true; changePreference(); } };
}

test('首页网格与顶部共享柔和入场，降低明暗反差并保持充分重叠', () => {
  const env = environment();
  env.motion.enterPage(env.root);
  const top = env.effects.find(effect => effect.node.name === '.welcome-copy');
  const toolbar = env.effects.find(effect => effect.node.name === '.library-toolbar');
  const grids = env.effects.filter(effect => effect.node.name === '#word-grid');
  assert.equal(grids.length, 1);
  const grid = grids[0];
  assert.equal(JSON.stringify(grid.frames), JSON.stringify(top.frames));
  assert.equal(grid.options.easing, top.options.easing);
  assert.equal(grid.options.duration, top.options.duration);
  assert.equal(grid.options.fill, 'backwards');
  assert.ok(grid.frames[0].opacity >= .4 && grid.frames[0].opacity <= .65);
  assert.ok(grid.options.duration >= 600 && grid.options.duration <= 750);
  assert.ok(grid.options.delay <= 120);
  assert.ok(grid.options.delay > toolbar.options.delay);
  assert.ok(grid.options.delay < top.options.duration / 2);
});

test('题目切换立即提交最新视图，连续操作取消旧动画且离场副本不可交互',()=>{
 const env=environment(), ghosts=[], commits=[];
 const panel={getBoundingClientRect:()=>({left:0,top:0}),append() {}};
 function question(name) {
  const node=env.element(name);
  node.getBoundingClientRect=()=>({left:12,top:24,width:600});
  node.closest=()=>panel;
  node.cloneNode=()=>{
   const ghost=env.element('retired');
   ghost.style={}; ghost.attributes={}; ghost.setAttribute=(key,value)=>{ghost.attributes[key]=value;};
   ghost.removeAttribute=()=>{}; ghost.querySelectorAll=()=>[]; ghost.remove=()=>{ghost.removed=true;};
   ghosts.push(ghost); return ghost;
  };
  return node;
 }
 env.elements.set('.question-content',question('old'));
 env.motion.transitionQuestion(()=>{commits.push(1);env.elements.set('.question-content',question('next'));},true);
 assert.equal(ghosts[0].inert,true);
 assert.equal(ghosts[0].attributes['aria-hidden'],'true');
 const oldEffects=[...env.effects];
 env.motion.transitionQuestion(()=>{commits.push(2);env.elements.set('.question-content',question('last'));},true);
 assert.deepEqual(commits,[1,2]);
 assert.ok(ghosts[0].removed);
 assert.ok(oldEffects.every(effect=>effect.cancelled));
 assert.equal(env.elements.get('.question-content').name,'last');
});

test('连续章节入场取消旧效果，搜索筛选只接管网格并立即提交最新内容', () => {
  const env = environment();
  env.motion.enterPage(env.root);
  const first = [...env.effects];
  env.motion.enterPage(env.root);
  assert.ok(first.every(effect => effect.cancelled));
  const current = env.effects.slice(first.length);
  const currentGrid = current.find(effect => effect.node.name === '#word-grid');
  const topCount = env.effects.filter(effect => effect.node.name === '.welcome-copy').length;
  const commits = [];
  env.motion.transitionGrid(() => commits.push('saved'));
  assert.ok(currentGrid.cancelled);
  assert.ok(current.filter(effect => effect !== currentGrid).every(effect => !effect.cancelled));
  const previousFilter = env.effects.at(-1);
  env.motion.transitionGrid(() => commits.push('all'));
  assert.ok(previousFilter.cancelled);
  assert.deepEqual(commits, ['saved', 'all']);
  assert.equal(env.effects.filter(effect => effect.node.name === '.welcome-copy').length, topCount);
});

test('减少动态效果会中止正在进行的入场，后续更新立即完成且不产生新动画', () => {
  const env = environment();
  env.motion.enterPage(env.root);
  env.reduce();
  assert.ok(env.effects.every(effect => effect.cancelled));
  const count = env.effects.length;
  env.motion.enterPage(env.root);
  let updated = false;
  env.motion.transitionGrid(() => { updated = true; });
  assert.ok(updated);
  assert.equal(env.effects.length, count);
});

test('练习面板继承首页缓动参数，不增加词网格入场', () => {
  const env = environment();
  env.elements.delete('.vocabulary-home');
  env.elements.set('.practice-panel', env.elements.get('.resume-banner'));
  env.motion.enterPage(env.root);
  assert.ok(!env.effects.some(effect => effect.node.name === '#word-grid'));
  const panel = env.effects.at(-1);
  assert.equal(panel.frames[0].opacity, .5);
  assert.equal(panel.options.duration, 640);
});

test('每日计划使用同一入场节奏且支持减少动态效果，不整页淡入',()=>{
 const env=environment();
 env.elements.set('.daily-plan-page',env.element('plan'));
 for(const selector of ['.plan-page-heading','.plan-overview','.plan-task-list','.plan-bottom'])env.elements.set(selector,env.element(selector));
 env.motion.enterPage(env.root);
 assert.equal(env.effects.length,4);assert.ok(env.effects.every(effect=>effect.options.duration===640));
 assert.ok(env.effects.every(effect=>effect.options.delay<=60));assert.ok(!env.effects.some(effect=>effect.node.name==='plan'));
 env.reduce();const count=env.effects.length;env.motion.enterPage(env.root);assert.equal(env.effects.length,count);
});
