import { escapeHTML as e } from '../utils/html.js';
import { Button, Progress } from '../components/controls.js';
import { icon } from '../components/icons.js';
import { WordItem } from '../components/WordItem.js';

const modeName=mode=>mode==='random'?'随机':'顺序';
export function planSourceText(dataset,source) {
  const names=(source?.chapterIds || []).map(id=>dataset.chapters.find(c=>c.id===id)?.name).filter(Boolean);
  return names.length>3?`${names.slice(0,2).join('、')} 等 ${names.length} 章`:names.length ? names.join('、') : '尚未选择新词章节';
}

// UI selection only: saved plan identities and order remain authoritative.
export function planContentSelection(plan,kind,display={}) {
  const items=plan.items.filter(item=>item.kind===kind);
  const pending=items.filter(item=>item.state!=='completed');
  const completed=items.filter(item=>item.state==='completed');
  const selected=display.scope==='all'?[...pending,...completed]:pending;
  const size=display.expanded?12:display.previewSize===4?4:3;
  const pages=Math.max(1,Math.ceil(selected.length/size));
  const page=display.expanded?Math.max(0,Math.min(pages-1,Math.trunc(display.page || 0))):0;
  return {items:selected.slice(page*size,(page+1)*size),total:items.length,pending:pending.length,completed:completed.length,
    selected:selected.length,page,pages,expanded:!!display.expanded,scope:display.scope==='all'?'all':'pending'};
}

export function DailyPlanPage({overview:{day,plan,counts:c,todayCount,backlog},dataset,session,goal,writable=true,savedIds=new Set(),notes={},contentState={},previewSize=3}) {
  const unfinished=!!session && session.status!=='finished';
  const remaining=c ? c.total-c.completed : 0;
  const pending=c ? c.pendingReview+c.pendingNew : 0;
  const date=new Intl.DateTimeFormat('zh-CN',{timeZone:'UTC',month:'long',day:'numeric',weekday:'long'}).format(new Date(`${day}T12:00:00Z`));
  const primary=unfinished ? Button({label:'继续未完成练习',action:'resume',variant:'primary',iconName:'arrow',disabled:!writable})
    : !plan ? Button({label:'设置今日计划',action:'plan-settings',variant:'primary',iconName:'arrow',disabled:!writable})
    : pending ? Button({label:'开始今日学习',action:'start-plan',variant:'primary',iconName:'arrow',attributes:'data-kind="all"',disabled:!writable})
    : c.pendingExtra ? Button({label:'继续额外复习',action:'start-plan',variant:'primary',attributes:'data-kind="extra"',iconName:'arrow',disabled:!writable})
    : Button({label:remaining?'任务暂不可用':c.total?'今日计划已完成':'暂无学习任务',action:'start-plan',variant:'secondary',iconName:c.total && !remaining?'check':'book',disabled:true});
  const wordMap=new Map(dataset.words.map(word=>[word.id,word]));
  const content=(kind,title,done,available)=>{
    const selection=planContentSelection(plan,kind,{...contentState[kind],previewSize});
    const attributes=command=>`data-kind="${kind}" data-command="${command}" data-page="${selection.page}"`;
    const browse=(label,command,disabled=false)=>Button({label,action:'plan-content',variant:'text-link',disabled,attributes:attributes(command)});
    const cards=selection.items.map(item=>{
      const word=wordMap.get(item.wordId);
      if(!word)return '<div class="plan-missing-word">词条暂不可用</div>';
      return WordItem({word,source:'plan',saved:savedIds.has(word.id),practiced:item.state==='completed',note:notes[word.id],
        statusText:item.state==='completed'?'已完成':''});
    }).join('');
    const empty=selection.total===0?kind==='review'?'暂无到期复习':'所选章节暂无可用新词':selection.pending===0?'本组已完成':'暂无待完成词汇';
    return `<section class="plan-content-section" data-plan-kind="${kind}" aria-labelledby="task-${kind}"><header class="plan-content-heading"><div><div class="plan-content-title"><h2 id="task-${kind}" tabindex="-1">${title}</h2><span class="plan-content-count" aria-label="已完成 ${done}，安排 ${selection.total} 词">${done} / ${selection.total}</span></div>${kind==='new'?Button({label:`${planSourceText(dataset,plan.newWordSource)} · ${modeName(plan.newWordSource.mode)}`,action:'plan-settings',variant:'text-link',disabled:!writable,attributes:'aria-label="调整新词来源与选词方式"'}):''}</div><div class="plan-section-action">${Button({label:available?kind==='review'?'开始复习':'学习新词':selection.total && done===selection.total?'已完成':selection.total?'暂不可练习':kind==='review'?'暂无到期复习':'暂无新词',action:'start-plan',variant:'secondary',disabled:!available || !writable,iconName:available?'arrow':'',attributes:`data-kind="${kind}"`})}</div></header>${Progress({label:`${title}进度`,value:done,max:selection.total || 1,className:'task-progress',valueText:`已完成${done}词，安排${selection.total}词`})}
    ${cards?`<div class="word-grid plan-word-grid" aria-label="${title}词条">${cards}</div>`:`<p class="plan-content-empty">${empty}${kind==='new' && !selection.total?Button({label:'调整章节',action:'plan-settings',variant:'text-link',disabled:!writable}):''}</p>`}
    ${selection.total?`<div class="plan-content-browse">${selection.expanded?`${browse('收起预览','collapse')}${browse(selection.scope==='all'?'只看待完成':`查看全部 ${selection.total} 词`,selection.scope==='all'?'pending':'all')}`:selection.total>3 || selection.completed?browse(selection.pending===0?`查看已学 ${selection.completed} 词`:`查看全部 ${selection.total} 词`,'all'):''}${selection.expanded && selection.pages>1?`<nav class="plan-pagination" aria-label="${title}分页">${browse('上一页','previous',selection.page===0)}<span>${selection.page+1} / ${selection.pages}</span>${browse('下一页','next',selection.page+1===selection.pages)}</nav>`:''}</div>`:''}</section>`;
  };
  return `<div class="daily-plan-page vocabulary-page" data-plan-day="${e(day)}"><header class="plan-page-heading"><div><p class="eyebrow">${e(date)}</p><h1>每日计划</h1></div>${Button({label:'设置',action:'plan-settings',variant:'text-link',iconName:'settings',disabled:!writable})}</header>
  <section class="plan-overview" aria-labelledby="plan-overview-heading"><div class="plan-overview-copy">${plan?`<h2 id="plan-overview-heading">今日待完成</h2><p class="plan-remaining"><strong>${remaining}</strong><span>词</span></p>${!c.total?'<p class="plan-empty-label">暂无可安排词汇</p>':''}`:`<h2 id="plan-overview-heading" class="plan-intro-title">从今天开始</h2><p class="plan-intro-copy">每日目标 ${goal} 词，先选择你的新词章节。</p>`}</div>
  <div class="plan-primary">${primary}${unfinished?`<span>${e(session.label)} · 已答 ${session.answers.length}/${session.questions.length} 题</span>`:''}</div>
  ${plan?`<div class="plan-progress-area"><div class="plan-progress-caption"><span>今日进度</span><strong>${c.completed} <span>/ ${c.total}</span></strong></div>${Progress({label:'基础计划完成进度',value:c.completed,max:c.total || 1,className:'plan-progress',valueText:`基础计划已练${c.completed}词，实际安排${c.total}词`})}</div>`:''}
  ${plan?`<details class="plan-details"><summary>计划详情${c.shortage?' · 未满目标':''}</summary><dl class="plan-statistics"><div><dt>今日目标</dt><dd>${plan.goalSnapshot} 词</dd></div><div><dt>实际安排</dt><dd>${c.total} 词</dd></div><div><dt>今日已练</dt><dd>${todayCount} 个不同单词</dd></div>${c.shortage?`<div><dt>缺额</dt><dd>${c.shortage} 词</dd></div>`:''}</dl>${c.shortage?`<p>${plan.newWordSource.chapterIds.length?'所选章节未学词不足，未补入其他章节。':'尚未选择新词章节，当前仅安排复习。'}</p>`:''}</details>`:''}
  ${c?.unavailable?`<p class="plan-notice">${icon('info')}<span>${c.unavailable} 个任务词暂不可用，原计划已保留。</span>${Button({label:'重新加载词库',action:'reload',variant:'text-link'})}</p>`:''}</section>
  ${plan?`<div class="plan-task-list" aria-label="今日学习内容">${content('review','到期复习',c.completedReview,c.pendingReview)}${content('new','今日新词',c.completedNew,c.pendingNew)}</div>`:''}
  ${plan && (backlog || c.extra)?`<section class="plan-extra"><div><h2>额外复习${backlog?`<span>${backlog} 词待领取</span>`:''}</h2>${c.extra?`<p>已练 ${c.completedExtra} / ${c.extra} 词</p>`:''}<p>不计入上方计划进度</p></div><div class="section-actions">${backlog?Button({label:'领取额外复习',action:'claim-extra',variant:'secondary',disabled:!writable}):''}${c.pendingExtra?Button({label:'开始额外复习',action:'start-plan',variant:'text-link',disabled:!writable,attributes:'data-kind="extra"',iconName:'arrow'}):''}</div></section>`:''}

  </div>`;
}
