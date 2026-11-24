import { Button, Progress } from '../components/controls.js';
import { escapeHTML as e, formatTime } from '../utils/html.js';
import { TYPE_LABELS, RATING_LABELS } from '../core.js';
import { icon } from '../components/icons.js';

function recallMarkup(s, w, feedback) {
  const revealed = s.revealed || !!feedback;
  const rating = feedback?.rating || (feedback?.correct ? 'correct' : 'wrong');
  return `<div class="recall-answer">
    ${revealed ? `<div class="meaning-panel" aria-label="参考释义"><span>参考释义</span><p>${e(w.meanings.join('；'))}</p></div>` : `<button id="reveal-meaning" class="meaning-placeholder" data-action="reveal-meaning" data-id="${e(w.id)}" aria-label="显示释义"><span>显示释义</span></button>`}
    ${revealed && !feedback ? `<div id="recall-ratings" class="recall-rating-group" role="group" aria-label="评价本次回忆" tabindex="-1"><div class="rating-buttons">${Object.entries(RATING_LABELS).map(([value,label], index) => `<button class="rating-button rating-${value}" data-action="rate-recall" data-id="${e(w.id)}" data-rating="${value}" aria-keyshortcuts="${index + 1}"><strong><kbd aria-hidden="true">${index + 1}</kbd>${label}</strong></button>`).join('')}</div></div>` : ''}
    ${feedback ? `<div class="answer-feedback ${rating === 'correct' ? 'is-correct' : rating === 'fuzzy' ? 'is-fuzzy' : 'is-incorrect'}" role="status"><strong>${icon(rating === 'correct' ? 'check' : 'info')} ${feedback.rating ? `自评：${RATING_LABELS[rating]}` : '上次作答记录'}${rating === 'correct' ? '' : ' · 已收录至错题本'}</strong>${!feedback.rating && feedback.input ? `<p>上次输入：${e(feedback.input)}</p>` : ''}<button class="text-link" data-action="detail" data-id="${e(w.id)}">单词详情</button></div>` : ''}
    <div class="answer-actions"><button class="text-button" data-action="speak" data-id="${e(w.id)}" aria-label="重复播放本题发音">${icon('sound')} 播放发音</button>${feedback ? `${Button({label:`${s.index === s.questions.length - 1 ? '查看本轮结果' : '下一题'}`,variant:'primary',action:'recall-next',iconName:'arrow',attributes:`id="recall-next"`})}` : ''}</div>
  </div>`;
}
export function PracticePage({session:s, word:w, feedback, counts, hasRecall, remaining, goal, saved}) {
  const q = s.questions[s.index];
  const planned=s.source==='daily-plan';
  const title=planned?({review:'今日复习',new:'今日新词',all:'今日学习',extra:'额外复习'}[s.planKind] || s.label):s.label;
  const context=planned?`每日计划 · ${s.planDayKey}`:{chapter:'自主章节练习',saved:'生词本练习',mistakes:'错题巩固'}[s.source];
  return `<div class="practice-heading"><button class="text-button" data-action="leave-practice">${icon('back')} ${planned?'返回每日计划':'返回词库'}</button><button class="text-button" data-action="end-round">结束本轮</button></div><div class="practice-layout"><div class="practice-workspace"><header class="practice-status">
    <div class="practice-meta"><div><p class="practice-source">${e(context || '')}</p><h1>${e(title)}</h1></div><div class="timer-chip ${s.timed && remaining < 60000 ? 'urgent' : ''}">${s.timed ? icon('clock') : ''}<span id="round-timer">${s.timed ? formatTime(remaining) : '不计时'}</span>${s.status === 'paused' ? '' : `<button data-action="pause" aria-label="暂停练习">${icon('pause')}</button>`}</div></div>
    <div class="round-progress-caption"><span>已答 <strong>${s.answers.length} / ${s.questions.length}</strong></span><span class="answer-counts"><span>正确 ${counts.correct}</span>${hasRecall ? `<span>模糊 ${counts.fuzzy}</span>` : ''}<span>错误 ${counts.wrong}</span></span></div>${Progress({label:'本轮答题进度',value:s.answers.length,max:s.questions.length,className:"round-progress"})}
    </header><section class="practice-panel">${s.status === 'paused' ? `<div class="paused-state"><h2>练习已暂停</h2>${s.timed ? '<p>倒计时已停止</p>' : ''}${Button({label:`继续练习`,variant:'primary',action:'pause',iconName:'play'})}</div>` : `<div class="question-content"><div class="question-type">${TYPE_LABELS[q.type]}</div>
      ${q.type === 'listening' && !feedback ? `<button class="listening-trigger" data-action="speak" data-id="${e(w.id)}" aria-label="播放本题单词">${icon('sound')}</button>` : `<h2 class="question-prompt ${q.type === 'en-zh' || feedback && q.type === 'listening' ? 'english-prompt' : ''}">${e(q.type === 'zh-en' ? w.meanings.join('；') : w.word)}</h2>${q.type === 'en-zh' && !s.revealed && !feedback ? '<p class="question-instruction">先回忆中文意思，再显示释义核对</p>' : ''}`}
      ${q.type === 'en-zh' ? recallMarkup(s, w, feedback) : `<form id="answer-form"><label class="sr-only" for="answer-input">你的答案</label><input id="answer-input" name="answer" class="answer-input ${feedback ? feedback.correct ? 'correct' : 'incorrect' : ''}" type="text" value="${e(feedback ? feedback.input : s.draft)}" placeholder="输入英文单词或词组" lang="en" autocomplete="off" autocapitalize="off" spellcheck="false" ${feedback ? 'readonly' : ''} maxlength="300">
      ${feedback ? `<div class="answer-feedback ${feedback.correct ? 'is-correct' : 'is-incorrect'}" role="status"><strong>${icon(feedback.correct ? 'check' : 'info')} ${feedback.correct ? '回答正确' : feedback.skipped ? '已跳过 · 已收录至错题本' : '回答错误 · 已收录至错题本'}</strong>${feedback.correct ? '' : `<p>正确答案：<b>${e(w.variants.join(' / '))}</b></p>`}<button type="button" class="text-link" data-action="detail" data-id="${e(w.id)}">单词详情</button></div>` : ''}
      <div class="answer-actions">${feedback ? '' : '<button type="button" class="text-button" data-action="skip">跳过</button>'}${q.type === 'listening' && !feedback ? '' : `<button type="button" class="text-button" data-action="speak" data-id="${e(w.id)}" aria-label="重复播放本题发音">${icon('sound')} 播放发音</button>`}${Button({label:`${feedback ? s.index === s.questions.length - 1 ? '查看本轮结果' : '下一题' : '提交答案'}`,variant:'primary',type:'submit',iconName:'arrow'})}</div></form>`}
      <div class="question-bottom"><button class="text-button save-practice ${saved ? 'saved' : ''}" data-action="save-word" data-id="${e(w.id)}" aria-pressed="${saved}">${icon('bookmark')} ${saved ? '已加入生词本' : '加入生词本'}</button><span>${q.type === 'en-zh' && !feedback ? s.revealed ? '' : '<kbd>空格</kbd> 显示释义' : ''}</span></div></div>`}
    </section></div><aside class="practice-aside">${goal}</aside></div>`;
}
