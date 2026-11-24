import { escapeHTML as e } from '../utils/html.js';
import { TYPE_LABELS } from '../core.js';
import { Button, Progress } from './controls.js';

export function GoalProgress({ goal, count, percent, complete, compact = false }) {
  return `<section class="daily-goal ${compact ? 'compact' : ''} ${complete ? 'goal-complete' : ''}" aria-label="今日学习目标"><div class="goal-top"><span>今日目标</span>${Button({label:'调整目标', action:'goal', variant:'text-link'})}</div><div class="goal-summary"><span class="goal-caption">已练</span><strong data-daily-count>${count}</strong><span> / ${goal} 词</span></div>${Progress({label:'每日目标完成进度',value:count,max:goal,className:'goal-progress',valueText:`已练 ${count} 词，目标 ${goal} 词，完成 ${percent}%`})}</section>`;
}
export function LastResult(session) {
  return session?.status === 'finished' ? Button({label:'上轮结果',action:'resume',variant:'text-link',className:'last-result'}) : '';
}
export function ResumeSession(session) {
  if (!session || session.status === 'finished') return '';
  return `<div class="resume-banner"><div class="resume-copy"><strong>${session.status === 'paused' ? '练习已暂停' : '练习未完成'}</strong><span class="resume-meta"><span>${e(session.label)}</span><span>${TYPE_LABELS[session.mode]}</span></span></div><div class="resume-progress"><span>已答 <strong>${session.answers.length}</strong> / ${session.questions.length} 题</span>${Progress({label:'本轮答题进度',value:session.answers.length,max:session.questions.length,className:'resume-meter'})}</div>${Button({label:'继续练习',action:'resume',variant:'text-link',iconName:'arrow'})}</div>`;
}

export function DailyPlanProgress({plan,counts,backlog}) {
  return `<section class="plan-context" data-daily-plan aria-label="每日计划进度"><div class="plan-context-heading"><strong>每日计划</strong>${Button({label:plan?'查看计划':'设置计划',action:'nav',variant:'text-link',attributes:'data-source="plan"'})}</div>${plan?`${Progress({label:'基础计划进度',value:counts.completed,max:counts.total || 1})}<p>复习 ${counts.completedReview}/${counts.review} · 新词 ${counts.completedNew}/${counts.new}</p><p>基础计划已练 ${counts.completed}/${counts.total}${counts.shortage?` · 缺额 ${counts.shortage}`:''}${counts.unavailable?` · 暂缺 ${counts.unavailable}`:''}</p>`:'<p>到期复习优先，剩余名额补充新词。</p>'}${backlog?`<p>计划外积压 ${backlog} 个到期词</p>`:''}</section>`;
}
