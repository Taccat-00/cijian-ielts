import { escapeHTML as e } from '../utils/html.js';
import { TYPES, TYPE_LABELS } from '../core.js';
import { icon } from '../components/icons.js';
import { ModalHeading as dialogHeading, Button } from '../components/controls.js';

export function WordDetails({word:w, chapterName, note, saved}) {
  const id=w.id;
  return `<div class="detail-top"><span class="eyebrow muted">${e(chapterName)}</span><button class="icon-button" data-action="close-dialog" aria-label="关闭单词详情">${icon('close')}</button></div><div class="detail-word"><h2 id="dialog-title" lang="en">${e(w.word)}</h2><button class="round-sound" data-action="speak" data-id="${e(id)}" aria-label="播放 ${e(w.word)} 发音">${icon('sound')}</button></div><div class="detail-phonetic"><span lang="en">${e(w.phonetic || '音标待补充')}</span><span class="pos">${e(w.pos)}</span>${w.variants.length > 1 ? `<span>其他拼写：${e(w.variants.slice(1).join(' / '))}</span>` : ''}</div><p class="detail-meaning">${e(w.meanings.join('；'))}</p>
      <section class="example-block"><h3>例句</h3>${w.example ? `<p lang="en">${e(w.example)}</p><div>${e(w.translation || '例句中文翻译待补充')}</div>${!w.enrichmentSource && w.source === 'my-ielts' ? '<small>候选词库例句，尚未校订</small>' : ''}` : '<p class="muted">例句待补充</p>'}</section>
      ${w.memory ? `<div class="memory-block"><div><h3>助记</h3><p>${e(w.memory)}</p></div></div>` : w.usage ? `<div class="memory-block"><div><h3>用法</h3><p>${e(w.usage)}</p></div></div>` : ''}
      <section class="notes-section"><div><h3>我的笔记</h3><span id="note-status">${note ? '已保存在本机' : '自动保存'}</span></div><textarea id="word-note" data-id="${e(id)}" maxlength="10000" placeholder="记录用法、易混词或例句" aria-label="${e(w.word)} 的个人笔记">${e(note || '')}</textarea></section><div class="detail-bottom">${Button({label:`${saved ? '已加入生词本' : '加入生词本'}`,variant:'secondary',action:'save-word',className:`save-detail ${saved ? 'saved' : ''}`,iconName:'bookmark',attributes:`data-id="${e(id)}" aria-pressed="${saved}"`})}</div>`;
}

export function GoalSettings(goal,hasPlan=false) {
  return `${dialogHeading('每日学习目标')}<p class="modal-intro">同一单词每天只计一次，显示释义或跳过不计入。${hasPlan?'今日计划已固定，目标调整从下个学习日生效。':''}</p><form id="goal-form"><label class="field-label" for="daily-target">每日目标词数</label><div class="goal-input"><input id="daily-target" name="goal" type="number" min="1" max="2000" step="1" value="${goal}" required><span>个单词 / 天</span></div><div class="modal-actions">${Button({label:`取消`,variant:'secondary',type:'button',action:'close-dialog'})}${Button({label:`保存目标`,variant:'primary',type:'submit',iconName:'check'})}</div></form>`;
}

export function DailyPlanSettings({dataset,settings,plan,goal,configuration}) {
  const chapters=configuration?.chapters ?? dataset.chapters;
  return `${dialogHeading(plan?'明日学习设置':'设置今日计划')}<p class="settings-effective" id="settings-effective">${icon('info')}${plan?'新设置将从下一个学习日生效。今日计划与已保存进度保持不变。':'到期复习优先，剩余名额从所选章节补充新词。'}</p>
  <form id="daily-plan-form" aria-describedby="settings-effective"><div class="plan-settings-top"><label class="field-label" for="plan-goal">每日目标</label><div class="plan-goal-control"><input id="plan-goal" name="goal" type="number" min="1" max="2000" step="1" value="${goal}" required><span>个不同单词 / 天</span></div></div>
  <fieldset class="plan-selection"><legend>选词方式</legend><div class="segmented-control">${[['ordered','顺序学习'],['random','随机学习']].map(([value,label])=>`<label class="segment-option"><input type="radio" name="selection" value="${value}" ${settings.mode===value?'checked':''}><span>${label}</span></label>`).join('')}</div></fieldset>
  <fieldset><legend>新词来源 <span class="muted">可多选</span></legend><div class="plan-chapter-grid">${chapters.map(c=>`<label class="plan-chapter"><input type="checkbox" name="chapters" value="${e(c.id)}" ${settings.chapterIds.includes(c.id)?'checked':''}><span class="plan-chapter-number">${e(c.id.padStart(2,'0'))}</span><span class="plan-chapter-name">${e(c.name)}${c.available!==undefined?`<small>未学 ${c.available} 词</small>`:''}</span><span class="chapter-check">${icon('check')}</span></label>`).join('')}</div><p class="configuration-count" id="plan-pool-count" aria-live="polite">已选 ${settings.chapterIds.length} 章${configuration?` · 未学 ${configuration.available} 词`:''}</p></fieldset>
  <p class="quiet-note">不选章节时仅安排复习。词数不足时保留缺额，不从其他章节补词。</p><div class="modal-actions">${Button({label:'取消',action:'close-dialog'})}${Button({label:plan?'保存明日设置':'生成今日计划',type:'submit',variant:'primary',iconName:'check'})}</div></form>`;
}

export function PlanPracticeSettings({kind,hasUnfinished,mode='en-zh'}) {
  const title={review:'到期复习',new:'今日新词',all:'今日学习',extra:'额外复习'}[kind];
  return `${dialogHeading(title)}<form id="plan-practice-form" data-kind="${e(kind)}"><fieldset><legend>本轮练习方式</legend><div class="mode-grid">${[...TYPES,'mixed'].map(type=>`<label class="mode-choice"><input type="radio" name="mode" value="${type}" ${mode===type?'checked':''}><span><strong>${TYPE_LABELS[type]}</strong></span></label>`).join('')}</div></fieldset>${hasUnfinished?'<p class="replace-warning">开始此范围将替换当前未完成的练习。已保存答案与计划进度保留。</p>':''}<div class="modal-actions">${Button({label:'取消',action:'close-dialog'})}${Button({label:hasUnfinished?'替换并开始':'开始练习',type:'submit',variant:'primary',iconName:'arrow'})}</div></form>`;
}

export function AboutDialog(dataset) {
  return `${dialogHeading('关于词间')}<p class="modal-intro">记录保存在当前浏览器，清除网站数据会丢失记录。</p><div class="about-facts"><div><span>当前词库</span><strong>${e(dataset.name)}</strong></div><div><span>词条 / 章节</span><strong>${dataset.words.length} / ${dataset.chapters.length}</strong></div><div><span>发音方式</span><strong>浏览器英语语音合成</strong></div></div><p class="quiet-note">${dataset.kind === 'local' ? '当前为本地导入的候选词表，尚未逐词校订；公开版本使用自编示例词库。原书音频未导入。' : `当前为 ${dataset.words.length} 条自编示例，不代表《雅思词汇真经》完整词表。`}</p>${dataset.kind === 'local' ? '<a class="text-link" href="https://github.com/hefengxian/my-ielts" target="_blank" rel="noopener noreferrer">查看候选词库来源 ↗</a>' : ''}<p class="quiet-note">英文答案接受词库列出的拼写变体。发音取决于浏览器和系统英语语音。</p>`;
}

export function PracticeSettings({dataset, settings, available, hasUnfinished}) {
  return `${dialogHeading('设置本轮练习')}<form id="practice-form">
    <fieldset><legend><span>选择练习范围</span></legend>${settings.source === 'chapter' ? `<div class="chapter-select-grid">${dataset.chapters.map(c => `<label class="chapter-choice"><input type="checkbox" name="chapters" value="${c.id}" ${settings.chapters.includes(c.id) ? 'checked' : ''}><span>${c.id.padStart(2,'0')} ${e(c.name)}</span></label>`).join('')}</div>` : `<div class="source-pill"> ${settings.source === 'saved' ? '生词本' : '错题本'}</div>`}<p class="quiet-note" id="pool-count">已选 ${available} 词</p></fieldset>
    <fieldset><legend><span>选择练习方式</span></legend><div class="mode-grid">${[...TYPES,'mixed'].map(type => `<label class="mode-choice"><input type="radio" name="mode" value="${type}" ${settings.mode === type ? 'checked' : ''}><span><strong>${TYPE_LABELS[type]}</strong>${type === 'en-zh' ? '<small>核对释义后自评</small>' : type === 'mixed' ? '<small>交替三种题型</small>' : ''}</span></label>`).join('')}</div></fieldset>
    <fieldset class="round-options"><legend><span>题数与计时</span></legend><label class="field-label">本轮题数<select name="count">${['10','20','50','all'].map(n => `<option value="${n}" ${settings.count === n ? 'selected' : ''}>${n === 'all' ? '所选全部单词' : n + ' 题'}</option>`).join('')}</select></label><div class="timer-option"><label class="toggle-label"><input type="checkbox" name="timed" ${settings.timed ? 'checked' : ''}> 开启整轮倒计时</label><label class="minutes-label"><input name="minutes" type="number" min="1" max="180" step="1" value="${settings.minutes}" ${settings.timed ? '' : 'disabled'} required> 分钟 / 轮</label></div></fieldset>
    <details class="practice-rules"><summary>练习规则</summary><p>错误、模糊和跳过会加入错题本。显示释义或跳过不计入每日目标；计时结束后，未答题不计错。</p></details>
    ${hasUnfinished ? '<p class="replace-warning">开始新一轮将替换未完成的练习，已提交的学习记录仍会保留。</p>' : ''}
    <div class="modal-actions"><span id="round-size" class="muted">本轮 ${settings.count === 'all' ? available : Math.min(Number(settings.count), available)} 题</span>${Button({label:`取消`,variant:'secondary',type:'button',action:'close-dialog'})}${Button({label:`开始练习`,variant:'primary',type:'submit',iconName:'arrow',attributes:`id="start-round"    ${available ? '' : 'disabled'}`})}</div></form>`;
}
