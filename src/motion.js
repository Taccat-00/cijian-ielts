// Native effects read the same tokens as CSS. No per-word animation queue.
const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
const running = new Set();
const pageEntrance = new Map();
let gridAnimation;
let questionEntrance;
let questionExit;
let retiringQuestion;
let progressAnimation;
const available = () => !preference.matches && typeof Element.prototype.animate === 'function';
function settings() {
  const css = getComputedStyle(document.documentElement);
  const value = name => css.getPropertyValue(name).trim();
  const duration = name => {
    const raw = value(name);
    return parseFloat(raw) * (raw.endsWith('ms') ? 1 : 1000);
  };
  return { fast:duration('--motion-duration-fast'), normal:duration('--motion-duration-normal'), slow:duration('--motion-duration-slow'), stagger:duration('--motion-stagger'), distance:parseFloat(value('--motion-distance-small')), ease:value('--motion-easing-emphasized'), home:{duration:duration('--home-motion-enter-duration'),stagger:duration('--home-motion-enter-stagger'),ease:value('--home-motion-enter-easing'),opacity:parseFloat(value('--home-motion-enter-opacity'))} };
}
function play(element, frames, options = {}) {
  if (!element || !available()) return null;
  const config = settings();
  const animation = element.animate(frames, {duration:config.normal, easing:config.ease, ...options});
  running.add(animation);
  animation.finished.catch(() => {}).finally(() => running.delete(animation));
  return animation;
}
function enterList(root) {
  if (!available()) return;
  play(root, [{opacity:.8,transform:`translateY(${settings().distance / 2}px)`},{opacity:1,transform:'translateY(0)'}]);
}
function enterPage(root) {
  // Dispose the previous chapter's effects; data commits remain synchronous.
  pageEntrance.forEach(animation => animation.cancel());
  pageEntrance.clear();
  if (!root || !available()) return;
  const config = settings();
  if(root.querySelector('.daily-plan-page')) {
    ['.plan-page-heading','.plan-overview','.plan-task-list','.plan-bottom','.plan-extra'].forEach((selector,index)=>{
      const element=root.querySelector(selector);
      const animation=play(element,[{opacity:config.home.opacity,transform:`translateY(${config.distance}px)`},{opacity:1,transform:'translateY(0)'}],
        {duration:config.home.duration,easing:config.home.ease,delay:index*config.home.stagger,fill:'backwards'});
      if(animation)pageEntrance.set(element,animation);
    });
    return;
  }
  const home = !!(root.querySelector('.vocabulary-home') || root.querySelector('.collection-page'));
  if (!home) {
    ['.practice-heading','.practice-status','.practice-panel','.practice-aside','.results-panel','.result-review'].map(selector=>root.querySelector(selector)).filter(Boolean).forEach((element,index)=> {
      play(element,[{opacity:config.home.opacity,transform:`translateY(${config.distance}px)`},{opacity:1,transform:'translateY(0)'}],{duration:config.home.duration,easing:config.home.ease,delay:index*config.home.stagger,fill:'backwards'});
    });
    return;
  }
  const entry = home ? config.home : {duration:config.slow,stagger:config.stagger,ease:config.ease,opacity:0};
  const sequence = ['.welcome-copy','.daily-goal','.resume-banner','.chapter-intro','.library-toolbar'];
  if (home) {
    gridAnimation?.cancel();
    // A gentle shared start avoids flashing to white on every chapter change.
    sequence.push('#word-grid');
  }
  sequence.forEach((selector,index) => {
    const element = root.querySelector(selector);
    const animation = play(element, [{opacity:entry.opacity,transform:`translateY(${config.distance}px)`},{opacity:1,transform:'translateY(0)'}], {duration:entry.duration,easing:entry.ease,delay:index * entry.stagger,fill:'backwards'});
    if (!home || !animation) return;
    pageEntrance.set(element, animation);
    animation.finished.catch(() => {}).finally(() => {
      if (pageEntrance.get(element) === animation) pageEntrance.delete(element);
    });
  });
}
function transitionGrid(update) {
  // Commit immediately: rapid filtering/navigation cannot replay a stale async update.
  gridAnimation?.cancel();
  const grid = document.querySelector('#word-grid');
  pageEntrance.get(grid)?.cancel();
  pageEntrance.delete(grid);
  update();
  if (available()) gridAnimation = play(document.querySelector('#word-grid'), [{opacity:.7,transform:`translateY(${settings().distance / 2}px)`},{opacity:1,transform:'translateY(0)'}]);
}
function openDialog(dialog) {
  if (available()) play(dialog, [{opacity:0,transform:`translateY(${settings().distance}px)`},{opacity:1,transform:'translateY(0)'}]);
}
function closeDialog(dialog, finish) {
  dialog.classList.add('is-closing');
  if (!available()) { finish(); return; }
  const config = settings();
  const animation = play(dialog, [{opacity:1,transform:'translateY(0)'},{opacity:0,transform:`translateY(${config.distance / 2}px)`}], {duration:config.fast,fill:'forwards'});
  animation.finished.catch(() => {}).then(finish);
}
function feedback(element) {
  if (available()) play(element, [{opacity:.5},{opacity:1}], {duration:settings().fast});
}
function transitionQuestion(update, changed) {
  const previousProgress=document.querySelector('.round-progress');
  const progressValue=previousProgress ? Number(previousProgress.getAttribute('aria-valuenow')) / Math.max(1,Number(previousProgress.getAttribute('aria-valuemax'))) : null;
  progressAnimation?.cancel();
  questionEntrance?.cancel(); questionExit?.cancel(); retiringQuestion?.remove();
  retiringQuestion=null;
  const previous=document.querySelector('.question-content');
  const rect=previous?.getBoundingClientRect();
  const panelRect=previous?.closest('.practice-panel')?.getBoundingClientRect();
  const ghost=changed && available() && previous ? previous.cloneNode(true) : null;
  if (ghost) {
    ghost.inert=true; ghost.setAttribute('aria-hidden','true');
    for (const node of [ghost,...ghost.querySelectorAll('*')]) { node.removeAttribute('id'); node.removeAttribute('data-action'); }
  }
  update(); // Commit immediately; no delayed callback can render a stale question.
  const progress=document.querySelector('.round-progress');
  if (progress && progressValue !== null && available()) {
    const value=Number(progress.getAttribute('aria-valuenow')) / Math.max(1,Number(progress.getAttribute('aria-valuemax')));
    if (value!==progressValue) progressAnimation=play(progress.querySelector('span'),[{width:`${progressValue*100}%`},{width:`${value*100}%`}]);
  }
  const next=document.querySelector('.question-content');
  if (!changed || !next || !available()) return;
  const config=settings();
  if (ghost) {
    ghost.style.cssText=`position:absolute;pointer-events:none;left:${rect.left-panelRect.left}px;top:${rect.top-panelRect.top}px;width:${rect.width}px;`;
    next.closest('.practice-panel').append(ghost);
    retiringQuestion=ghost;
    questionExit=play(ghost,[{opacity:.5,transform:'translateY(0)'},{opacity:0,transform:`translateY(${-config.distance/2}px)`}],{duration:config.fast});
    questionExit.finished.catch(()=>{}).finally(()=>{ghost.remove();if(retiringQuestion===ghost)retiringQuestion=null;});
  }
  questionEntrance=play(next,[{opacity:.5,transform:`translateY(${config.distance}px)`},{opacity:1,transform:'translateY(0)'}],{duration:config.normal+config.fast/2,easing:config.home.ease,delay:ghost?config.stagger:0,fill:'backwards'});
}
preference.addEventListener('change', () => { if (preference.matches) running.forEach(animation => animation.cancel()); });
export const motion = { enterList, enterPage, transitionGrid, transitionQuestion, openDialog, closeDialog, feedback };
