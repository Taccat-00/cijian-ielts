import { escapeHTML as e } from '../utils/html.js';
import { icon } from './icons.js';

// Attribute fragments are supplied only by trusted templates; data values must be escaped.
export function Button({ label, action = '', type = 'button', variant = 'secondary', className = '', iconName = '', disabled = false, attributes = '' }) {
  return `<button type="${e(type)}" class="button ${e(variant)} ${e(className)}" ${action ? `data-action="${e(action)}"` : ''} ${disabled ? 'disabled' : ''} ${attributes}>${iconName ? icon(iconName) : ''}${e(label)}</button>`;
}
export function IconButton({ label, action, id = '', iconName, className = '', attributes = '' }) {
  return `<button type="button" class="icon-button ${e(className)}" data-action="${e(action)}" ${id ? `data-id="${e(id)}"` : ''} aria-label="${e(label)}" title="${e(label)}" ${attributes}>${icon(iconName)}</button>`;
}
export function SearchField(value) {
  return `<label class="search-box">${icon('search')}<input id="word-search" type="search" value="${e(value)}" placeholder="搜索单词" aria-label="搜索单词或释义" autocomplete="off"></label>`;
}
export function FilterTabs(filter, source) {
  const items = [['all','全部词汇'], ['unpracticed','今日未练'], ...(source === 'saved' ? [] : [['saved','生词本']])];
  return `<div class="filter-tabs" role="group" aria-label="词汇筛选" style="--filter-count:${items.length};--filter-index:${Math.max(0,items.findIndex(([id])=>id===filter))}"><span class="filter-highlight" aria-hidden="true"></span>${items.map(([id,label]) => `<button type="button" data-action="filter" data-id="${id}" aria-pressed="${filter === id}" class="${filter === id ? 'active' : ''}">${label}</button>`).join('')}</div>`;
}
export function Progress({ label, value, max, className = '', valueText = '' }) {
  const current = Math.min(Math.max(0, value), max), percent = max > 0 ? current / max * 100 : 0;
  return `<div class="progress-track ${e(className)}" role="progressbar" aria-label="${e(label)}" aria-valuemin="0" aria-valuemax="${max}" aria-valuenow="${current}" ${valueText ? `aria-valuetext="${e(valueText)}"` : ''}><span style="width:${percent}%"></span></div>`;
}
export function EmptyState({ title, description = '', action, label, heading = 'h3' }) {
  return `<div class="empty-state"><${heading}>${e(title)}</${heading}>${description ? `<p>${e(description)}</p>` : ''}${Button({ label, action })}</div>`;
}
export function ModalHeading(title) {
  return `<div class="modal-heading"><h2 id="dialog-title">${e(title)}</h2>${IconButton({label:'关闭弹窗',action:'close-dialog',iconName:'close'})}</div>`;
}
