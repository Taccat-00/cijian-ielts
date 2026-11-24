import { escapeHTML as e } from '../utils/html.js';
import { icon } from './icons.js';

function brandLogo(compact = false) {
  return `<svg class="${compact ? 'brand-symbol' : 'brand-logo'}" viewBox="${compact ? '130 86 750 593' : '130 86 1778 593'}" aria-hidden="true" focusable="false"><image href="./brand-logo-transparent.png" x="0" y="0" width="2038" height="772" /></svg>`;
}

function navButton(source, which, symbol, title, count = '') {
  return `<button class="nav-item ${source === which ? 'active' : ''}" ${source === which ? 'aria-current="page"' : ''} data-action="nav" data-source="${which}">${icon(symbol)}<span>${title}</span>${count !== '' ? `<span class="nav-count">${count}</span>` : ''}</button>`;
}

export function AppShell({dataset, source, chapterId, chapterCounts, mistakesCount, savedCount, storageWarning, dataWarning}) {
  return `
    <a class="skip-link" href="#page">跳到学习内容</a><aside id="study-navigation" class="sidebar" aria-label="学习导航"><button class="mobile-nav-close icon-button" data-action="close-nav" aria-label="关闭学习导航">${icon("close")}</button>
      <a href="#" class="brand" aria-label="词间 CIJIAN · IELTS" data-action="home">${brandLogo()}</a>
      <nav class="main-nav">${navButton(source, 'plan','calendar','每日计划')}${navButton(source, 'chapter','grid','章节词库')}${navButton(source, 'mistakes','mistake','错题本',mistakesCount)}${navButton(source, 'saved','bookmark','生词本',savedCount)}</nav>
      <div class="chapter-caption">词书章节</div>
      <nav class="chapters" aria-label="词书章节">${dataset.chapters.map((c, i) => `<button class="chapter-item ${source === 'chapter' && c.id === chapterId ? 'active' : ''}" data-action="chapter" data-id="${c.id}" ${source === 'chapter' && c.id === chapterId ? 'aria-current="page"' : ''}><span class="chapter-number">${String(i + 1).padStart(2,'0')}</span><span>${e(c.name)}</span><span class="chapter-count">${chapterCounts.get(c.id)}</span></button>`).join('')}</nav>
      <button class="sidebar-footer" data-action="about">${icon('info')}<span>学习说明</span></button>
    </aside>
    <button class="nav-scrim" data-action="close-nav" aria-label="关闭学习导航" tabindex="-1"></button><main class="main">
      <header class="topbar"><button class="mobile-nav-toggle" data-action="toggle-nav" aria-controls="study-navigation" aria-expanded="false" aria-label="打开学习导航">${brandLogo(true)}<span>词间</span></button></header>
      <div id="storage-warning" class="storage-warning" role="alert" ${storageWarning ? '' : 'hidden'}>${e(storageWarning)}</div>
      <div class="storage-warning" ${dataWarning ? '' : 'hidden'}>${e(dataWarning)}</div><div id="page" class="page" tabindex="-1"></div>

    </main>`;
}
