import { escapeHTML as e } from '../utils/html.js';
import { Button, SearchField, FilterTabs, EmptyState } from '../components/controls.js';
import { WordItem } from '../components/WordItem.js';
import { LastResult, ResumeSession } from '../components/Progress.js';

export function VocabularyPage({ source, title, count, goal, plan='', session, search, filter }) {
  const chapterSource = source === 'chapter';
  const practiceActions = `<div class="section-actions">${chapterSource ? Button({label:'多章混合练习',action:'setup',attributes:'data-multi="true"'}) : ''}${Button({label:chapterSource ? '开始本章练习' : '开始复习',action:'setup',variant:'primary',disabled:!count})}</div>`;
  const overviewTitle = chapterSource
    ? `<span class="overview-label">当前章节</span><div class="chapter-heading"><h1 id="library-heading">${e(title)} <span class="count-label">${count} 词</span></h1>${LastResult(session)}</div>`
    : `<div class="chapter-heading"><h1 id="library-heading">${e(title)} <span class="count-label">${count} 词</span></h1>${LastResult(session)}</div>`;
  return `<div class="vocabulary-page ${chapterSource ? 'vocabulary-home' : 'collection-page'}"><section class="study-overview" aria-label="学习概览"><div class="welcome"><div class="welcome-copy">${overviewTitle}</div>${chapterSource ? goal : practiceActions}</div><div id="resume-slot">${ResumeSession(session)}</div></section>
    ${plan}<section class="library-section" aria-label="${e(title)}词汇">
      <div class="library-toolbar">${SearchField(search)}${chapterSource ? practiceActions : ''}${FilterTabs(filter,source)}<span id="grid-count" role="status" aria-live="polite"></span></div>
      <div id="word-grid" class="word-grid"></div>
    </section></div>`;
}
export function VocabularyWords({ words, source, savedIds, today, notes, mistakes, reviewStates={}, search, filter }) {
  if (words.length) return words.map(word => WordItem({word,source,saved:savedIds.has(word.id),practiced:today.has(word.id),note:notes[word.id],mistake:mistakes[word.id],review:Object.hasOwn(reviewStates,word.id)?reviewStates[word.id]:undefined})).join('');
  const filtered = search || filter !== 'all';
  return EmptyState({title:filtered ? (source === 'chapter' ? '当前章节没有符合条件的单词' : '没有符合条件的单词') : source === 'saved' ? '生词本暂无单词' : '暂无错题记录', description:!filtered && source === 'mistakes' ? '答错、跳过或自评模糊的词会自动收录。' : '',action:filtered ? 'clear-filter' : 'home',label:filtered ? '清除筛选' : '浏览章节词汇',heading:source === 'chapter' ? 'h3' : 'h2'});
}
