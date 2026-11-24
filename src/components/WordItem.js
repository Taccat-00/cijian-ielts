import { escapeHTML as e } from '../utils/html.js';
import { IconButton } from './controls.js';

export function WordItem({word: w, saved, practiced, note, mistake, review, source = 'chapter', concealed = false, previewLabel = '复习词', statusText}) {
  const heading = source === 'chapter' || source === 'plan' ? 'h3' : 'h2';
  // Concealed previews omit answer text entirely, including accessible labels and audio.
  const title = concealed ? `<${heading} class="word-title">${e(previewLabel)}</${heading}>` : `<${heading} class="word-title" aria-label="${e(w.word)}" lang="en"><button type="button" class="word-link" data-action="detail" data-id="${e(w.id)}" aria-label="查看 ${e(w.word)} 详情与笔记" title="查看例句与笔记" lang="en">${e(w.word)}</button></${heading}>`;
  const bookmark = `${IconButton({label:`${saved ? '已加入生词本' : '加入生词本'}：${concealed?previewLabel:w.word}${saved?'（点击移出）':''}`,action:'save-word',id:w.id,iconName:'bookmark',className:`bookmark-button ${saved ? 'saved' : ''}`,attributes:`aria-pressed="${!!saved}"`})}`;
  const sound = concealed ? '' : `${IconButton({label:`播放 ${w.word} 发音`,action:'speak',id:w.id,iconName:'sound',className:'pronounce-button'})}`;
  const metadata = concealed ? '' : `${w.phonetic ? `<span class="phonetic" lang="en">${e(w.phonetic)}</span>` : ''}<span class="pos">${e(w.pos)}</span>`;
  return `<article class="word-card ${practiced ? 'is-practiced' : ''} ${concealed?'is-concealed':''}" data-word-id="${e(w.id)}">
    <div class="word-card-body">
      <div class="word-heading">
        ${title}
        <div class="word-meta">${metadata}</div>
      </div>
      <div class="word-actions">
        ${bookmark}
        ${sound}
      </div>
    </div>
    <div class="word-translation">${concealed?`<button type="button" class="button text-link" data-action="reveal-plan-word" data-id="${e(w.id)}" aria-label="查看${e(previewLabel)}">查看单词</button>`:`<p class="card-definition">${e(w.meanings.join('；'))}</p>`}</div>
    <div class="card-record">${note ? '<span class="note-indicator">有笔记</span>' : ''}${statusText || practiced ? `<span class="word-status practiced">${e(statusText ?? '今日已练')}</span>` : ''}</div>
    ${source!=='chapter' && review?`<p class="word-review-info">${iconForReview(review)}${review.due?'已到期，可复习':`下次复习 ${e(review.nextReviewAt)}`}</p>`:''}
    ${source === 'mistakes' ? `<div class="mistake-footer"><span>收录 ${mistake?.count || 1} 次${mistake?.lastRating === 'fuzzy' ? '，最近模糊' : ''}</span><button type="button" data-action="remove-mistake" data-id="${e(w.id)}">移出错题本</button></div>` : ''}
  </article>`;
}

function iconForReview(review) { return `<span aria-hidden="true" class="review-dot ${review.due?'is-due':''}"></span>`; }
