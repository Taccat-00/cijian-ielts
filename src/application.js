import { motion } from './motion.js';
import { STORAGE_KEY, normalizeEnglish, dailyCount, dailyProgress, studyDate, effectiveGoal, answerCounts, remainingTime } from './core.js';
import { openLearningStorage } from './review/bootstrap.js';
import { createLearningService, planConfigurationOptions, wordReviewStates } from './review/service.js';
import { createV2State } from './review/schema.js';
import { dailyOverview } from './review/daily-plan.js';
import { escapeHTML as e, formatTime } from './utils/html.js';
import { icon } from './components/icons.js';
import { ModalHeading as dialogHeading, Button } from './components/controls.js';
import { createModal } from './components/Modal.js';
import { AppShell } from './components/AppShell.js';
import { StorageNotice } from './components/StorageNotice.js';
import { GoalProgress, ResumeSession, LastResult, DailyPlanProgress } from './components/Progress.js';
import { VocabularyPage, VocabularyWords } from './pages/VocabularyPage.js';
import { PracticePage } from './pages/PracticePage.js';
import { ResultsPage } from './pages/ResultsPage.js';
import { DailyPlanPage } from './pages/DailyPlanPage.js';
import { WordDetails, GoalSettings, AboutDialog, PracticeSettings, DailyPlanSettings, PlanPracticeSettings } from './pages/dialogs.js';
const $ = (selector, root = document) => root.querySelector(selector);

export async function startApplication(dataset, dataWarning = '', options = {}) {
  const clock=options.clock ?? Date.now;
  const wordMap = new Map(dataset.words.map(word => [word.id, word]));
  const searchIndex = new Map(dataset.words.map(word => [word.id, [word.word, ...word.variants, ...word.meanings].map(normalizeEnglish).join('\n')]));
  const chapterWords = new Map(dataset.chapters.map(chapter => [chapter.id, dataset.words.filter(word => word.chapters.includes(chapter.id))]));
  let state, storageWarning = '', persistenceDisabled = false, storageConflict = false, persistence, service, release=()=>{};
  try {
    const opened=await openLearningStorage(options.storage ?? localStorage,{...options,clock});
    state=opened.state;persistence=opened.repository;release=opened.release;
    persistenceDisabled=!opened.writable;storageWarning=opened.warning;
    if(persistence) {
      service=createLearningService(persistence,dataset,{clock});
      await service.settle();state=service.snapshot();
    }
  } catch(error) {
    if(error.code==='MIGRATION_REQUIRED') {
      $('#app').innerHTML=`<section class="migration-page"><p class="eyebrow">学习记录升级</p><h1>为已有记录启用智能复习</h1><p>生词本、错题、笔记和学习记录会保留。</p><ol class="migration-steps"><li>关闭其他旧版词间学习页面。</li><li>系统先备份原始记录，再升级数据格式。</li><li>已有学习记录将进入待评估复习队列。</li></ol><div class="section-actions"><button class="button primary" id="migrate-records">已关闭旧页，备份并升级</button><button class="button secondary" id="browse-readonly">只读浏览</button></div><p>备份冲突或保存失败时会停止升级，保留原数据。</p></section>`;
      $('#migrate-records').addEventListener('click',async event=>{event.target.disabled=true;event.target.textContent='正在备份并升级…';await startApplication(dataset,dataWarning,{...options,allowMigration:true});});
      $('#browse-readonly').addEventListener('click',()=>startApplication(dataset,dataWarning,{...options,readOnly:true}));
      return;
    }
    release();service=null;persistence=null;
    state = createV2State({now:clock()});
    persistenceDisabled = true;
    storageWarning = `学习记录未能安全加载，原数据未覆盖；当前仅可浏览词库。${error.message}`;
  }
  window.addEventListener('pagehide',()=>release(),{once:true});
  window.addEventListener('pageshow',event=>{if(event.persisted)location.reload();});
  let view = 'library', source = 'chapter', chapterId = dataset.chapters[0].id, search = '', filter = 'all', toastTimer;
  let settingsDraft = { source: 'chapter', chapters: ['1'], mode: 'zh-en', count: '20', timed: false, minutes: 10 };
  const today=()=>studyDate(state,new Date(clock()));
  let lastDate = today(), speechContext = '', pendingDateRefresh = false, busy=false;
  const inputDrafts=new Map();
  let pendingSave=null;
  let planContent={day:null,review:{},new:{},revealed:new Set()};
  const overview=()=>service?service.overview():dailyOverview(state,dataset,clock());
  const writable=()=>!persistenceDisabled && !storageConflict;
  function reflectAccess() {
    if(writable())return;
    document.querySelectorAll('[data-action="save-word"],[data-action="remove-mistake"],[data-action="start-plan"],[data-action="claim-extra"],[data-action="resume"],[data-action="pause"],[data-action="goal"],[data-action="setup"],[data-action="reveal-meaning"],[data-action="rate-recall"],[data-action="skip"],[data-action="recall-next"],[data-action="end-round"],[data-action="confirm-end"],[data-action="review-round"],#start-round,form button[type="submit"]').forEach(button=>{button.disabled=true;});
    document.querySelectorAll('#word-note,#answer-input').forEach(input=>{input.readOnly=true;});
    document.querySelectorAll('#daily-plan-form input').forEach(input=>{input.disabled=true;});
  }
  function clearSpeechFeedback() { document.querySelectorAll('.is-speaking').forEach(button => { button.classList.remove('is-speaking'); button.removeAttribute('aria-busy'); }); }
  function cancelSpeech() { window.speechSynthesis?.cancel(); clearSpeechFeedback(); }

  function showStorageWarning() {
    const banner = $('#storage-warning');
    if (banner) { banner.hidden = !storageWarning; banner.innerHTML = storageWarning?StorageNotice({message:storageWarning,readOnly:persistenceDisabled,conflict:storageConflict,retry:!!pendingSave}):''; }
    reflectAccess();
    const noteStatus = $('#note-status');
    if (noteStatus && (storageWarning || persistenceDisabled)) noteStatus.textContent = '尚未保存，请先复制笔记内容';
  }
  function checkStorage() {
    if (persistenceDisabled) return false;
    try {
      if (!persistence.isCurrent()) {
        storageConflict = true;
        storageWarning = '其他页面已更改学习记录，此页已停止保存。请复制尚未保存的笔记，再重新加载。';
        showStorageWarning();
        return false;
      }
    } catch { /* Let persist report unavailable storage without blocking learning. */ }
    return !storageConflict;
  }
  async function update(action,{quiet=false,key}={}) {
    if (persistenceDisabled || !checkStorage()) return false;
    const control=!quiet && document.activeElement?.tagName==='BUTTON'?document.activeElement:null;
    const disabledBefore=control?.disabled;
    if(control){control.disabled=true;control.setAttribute('aria-busy','true');}
    try {
      await action();state=service.snapshot();
      if(!quiet || (pendingSave?.quiet && pendingSave.key===key)){pendingSave=null;storageWarning='';}else if(!pendingSave)storageWarning='';
      showStorageWarning(); return true;
    } catch (error) {
      state=service.snapshot();
      storageConflict = error.code === 'STORAGE_CONFLICT';
      if(!quiet || !pendingSave || (pendingSave.quiet && pendingSave.key===key))pendingSave={action,quiet,key};
      storageWarning = storageConflict ? '其他页面已更改学习记录，此页已停止保存。请复制尚未保存的笔记，再重新加载。' : `操作未保存：${error.message}。原记录保留，可使用相同题目重试。`;
      if(!quiet)toast(storageWarning);
      showStorageWarning(); return false;
    } finally {
      if(control?.isConnected){control.disabled=disabledBefore;control.removeAttribute('aria-busy');}
      reflectAccess();
    }
  }
  function toast(message) {
    clearTimeout(toastTimer);
    const target = $('dialog[open] .dialog-toast') || $('#toast');
    target.textContent = message; target.classList.add('show');
    toastTimer = setTimeout(() => target.classList.remove('show'), 2800);
  }
  function todayIds() { return new Set(state.daily[today()] || []); }
  function knownSaved() { return state.saved.filter(id => wordMap.has(id)); }
  function knownMistakes() { return Object.keys(state.mistakes).filter(id => wordMap.has(id)); }
  function sourceWords(current = source) {
    if (current === 'saved') return state.saved.map(id => wordMap.get(id)).filter(Boolean);
    if (current === 'mistakes') return knownMistakes().sort((a, b) => state.mistakes[b].lastAt - state.mistakes[a].lastAt).map(id => wordMap.get(id));
    return chapterWords.get(chapterId) || [];
  }
  const chapter = () => dataset.chapters.find(c => c.id === chapterId);
  const sourceTitle = () => source === 'saved' ? '生词本' : source === 'mistakes' ? '错题本' : chapter().name;

  function renderShell() {
    $('#app').innerHTML = AppShell({dataset, source, chapterId, chapterCounts:new Map([...chapterWords].map(([id,words]) => [id,words.length])), mistakesCount:knownMistakes().length, savedCount:knownSaved().length, storageWarning, dataWarning});
    document.body.classList.remove('nav-open');
    $('.sidebar').inert = window.matchMedia('(max-width: 900px)').matches;
    renderPage();
    if (view === 'practice' && !$('.results-panel')) motion.enterPage($('#page'));
    showStorageWarning();
  }
  function goalMarkup(compact = false) {
    return GoalProgress({...dailyProgress(state,new Date(clock())), goal:effectiveGoal(state,new Date(clock())), compact});
  }
  function focusHeading() {
    const heading=$('#page h1');
    if(heading){heading.tabIndex=-1;heading.focus({preventScroll:true});}
  }
  function unavailableStudy(result=false) {
    return `<section class="study-unavailable" role="status"><h1>词汇暂不可用</h1><p>${result?'原结果':'原会话'}包含当前词库缺失的词汇。记录已保留，请恢复词库后继续。</p><div class="section-actions">${Button({label:'重新加载词库',action:'reload',variant:'primary'})}${Button({label:state.session?.source==='daily-plan'?'返回每日计划':'返回词库',action:'leave-practice'})}</div></section>`;
  }
  function renderPage() {
    if (view === 'practice' && state.session) { renderPractice(); return; }
    if(source==='plan') {
      renderPlanContent();motion.enterPage($('#page'));return;
    }
    $('#page').innerHTML = VocabularyPage({source,title:sourceTitle(),count:sourceWords().length,goal:goalMarkup(),session:state.session,search,filter});
    renderCards('page');
    motion.enterPage($('#page'));
    reflectAccess();
  }
  function renderPlanContent() {
    const current=overview();
    if(planContent.day!==current.day)planContent={day:current.day,review:{},new:{},revealed:new Set()};
    $('#page').innerHTML=DailyPlanPage({overview:current,dataset,session:state.session,goal:state.goal,writable:writable(),
      savedIds:new Set(state.saved),notes:state.notes,contentState:planContent,
      previewSize:window.matchMedia('(min-width:641px) and (max-width:1200px)').matches?4:3});
    reflectAccess();
  }
  function renderCards(reason = 'refresh') {
    const query = normalizeEnglish(search), today = todayIds();
    const current = sourceWords(), savedIds = new Set(state.saved);
    $('#library-heading .count-label').textContent = `${current.length} 词`;
    document.querySelectorAll('.section-actions [data-action="setup"]:not([data-multi])').forEach(button => { button.disabled = current.length === 0; });
    const words = current.filter(w => (!query || searchIndex.get(w.id).includes(query)) && (filter !== 'unpracticed' || !today.has(w.id)) && (filter !== 'saved' || savedIds.has(w.id)));
    $('#grid-count').textContent = query || filter !== 'all' ? `${words.length} 个结果` : '';
    $('#word-grid').innerHTML = VocabularyWords({words,source,savedIds,today,notes:state.notes,mistakes:state.mistakes,reviewStates:source==='chapter'?undefined:service?service.reviewStates():wordReviewStates(state,clock()),search,filter});
    reflectAccess();
    // Chapter entrance is coordinated with the upper modules by enterPage.
  }
  function updateCounts() {
    const mistakesBadge = $('[data-action="nav"][data-source="mistakes"] .nav-count');
    const savedBadge = $('[data-action="nav"][data-source="saved"] .nav-count');
    if (mistakesBadge) mistakesBadge.textContent = knownMistakes().length;
    if (savedBadge) savedBadge.textContent = knownSaved().length;
  }
  function lastResultMarkup() { return LastResult(state.session); }
  function resumeMarkup() { return ResumeSession(state.session); }
  function setFilter(nextFilter) {
    motion.transitionGrid(() => {
      filter = nextFilter;
      $('.filter-tabs').querySelectorAll('button').forEach(button => {
        button.classList.toggle('active', button.dataset.id === filter);
        button.setAttribute('aria-pressed', String(button.dataset.id === filter));
      });
      const tabs=$('.filter-tabs');
      tabs.style.setProperty('--filter-index',String([...tabs.querySelectorAll('button')].findIndex(button=>button.dataset.id===filter)));
      renderCards();
    });
  }
  async function toggleSaved(id) {
    if (!wordMap.has(id)) return;
    const saved = state.saved.includes(id);
    if(!await update(()=>service.toggleSaved(id)))return;
    updateCounts();
    const focus = document.activeElement;
    const focusAction = focus?.dataset?.action;
    if ($('#word-grid')) {
      renderCards();
      if (!$('dialog[open]') && focusAction) {
        [...document.querySelectorAll('[data-action]')].find(button => button.dataset.id === id && button.dataset.action === focusAction)?.focus({preventScroll:true});
        if (!document.activeElement || document.activeElement === document.body) $('#word-search')?.focus({preventScroll:true});
      }
    }
    document.querySelectorAll('[data-action="save-word"]').forEach(button => {
      if (button.dataset.id !== id) return;
      button.classList.toggle('saved', !saved);
      button.setAttribute('aria-pressed', String(!saved));
      const label=`${saved ? '加入生词本' : '已加入生词本'}${button.classList.contains('save-practice') ? '' : `：${wordMap.get(id).word}`}${saved?'':'（点击移出）'}`;
      button.setAttribute('aria-label',label);button.title=label;
      if (button.classList.contains('save-detail') || button.classList.contains('save-practice')) button.innerHTML = `${icon('bookmark')} ${saved ? '加入生词本' : '已加入生词本'}`;
    });
    motion.feedback([...document.querySelectorAll('.bookmark-button')].find(button => button.dataset.id === id));
    toast(saved ? '已移出生词本' : '已加入生词本');
    if(source==='plan' && view!=='practice') {
      renderPlanContent();
      [...document.querySelectorAll('.bookmark-button')].find(button=>button.dataset.id===id)?.focus({preventScroll:true});
    }
  }

  const modal = createModal({
    root:$('#dialog-root'),
    onOpen:showStorageWarning,
    onClose(dialog) {
      const note = $('#word-note', dialog);
      if (!note || !$('#word-grid,.plan-word-grid')) return;
      const card = [...document.querySelectorAll('.word-card')].find(card => card.dataset.wordId === note.dataset.id);
      card?.querySelector('.note-indicator')?.remove();
      if (card && state.notes[note.dataset.id]) card.querySelector('.card-record').insertAdjacentHTML('afterbegin', '<span class="note-indicator">有笔记</span>');
    }
  });
  const openDialog = modal.open, closeDialog = modal.close;
  function showWord(id) {
    const w = wordMap.get(id); if (!w) return;
    const saved = state.saved.includes(id);
    openDialog(WordDetails({word:w,chapterName:dataset.chapters.find(c => c.id === w.chapters[0]).name,note:state.notes[id] || '',saved}), 'word-modal');
  }
  function showGoal() { openDialog(GoalSettings(state.goal,Boolean(state.srs.dailyPlans[today()])), 'small-modal'); }
  function showPlanSettings() {
    const settings=state.srs.planSettings ?? {chapterIds:[chapterId],mode:'ordered'};
    const configuration=service?service.configurationOptions(settings.chapterIds):planConfigurationOptions(state,dataset,clock(),settings.chapterIds);
    openDialog(DailyPlanSettings({dataset,settings,configuration,plan:state.srs.dailyPlans[today()],goal:state.goal}),'plan-settings-modal');
  }
  function showAbout() { openDialog(AboutDialog(dataset), 'small-modal'); }
  function openSetup(multi = false) {
    const previous = view === 'practice' ? state.session : null;
    settingsDraft.source = previous?.source==='daily-plan' || source==='plan' ? 'chapter' : previous?.source || source;
    settingsDraft.chapters = previous?.chapterIds?.length ? previous.chapterIds : multi && settingsDraft.chapters.length > 1 ? settingsDraft.chapters : [chapterId];
    settingsDraft.chapters = settingsDraft.chapters.filter(id => chapterWords.has(id));
    if (!settingsDraft.chapters.length) settingsDraft.chapters = [chapterId];
    if (previous) settingsDraft.mode = previous.mode;
    renderSetup();
  }
  function setupWords() {
    return settingsDraft.source === 'chapter' ? dataset.words.filter(w => w.chapters.some(id => settingsDraft.chapters.includes(id))) : sourceWords(settingsDraft.source);
  }
  function renderSetup() {
    openDialog(PracticeSettings({dataset,settings:settingsDraft,available:setupWords().length,hasUnfinished:state.session && state.session.status !== 'finished'}), 'setup-modal');
  }

  function renderPractice() {
    const previousQuestion = $('.question-content')?.dataset.questionKey;
    const s = state.session;
    const context = s ? `${s.sessionId}/${s.index}/${s.status}` : '';
    if (context !== speechContext) { cancelSpeech(); speechContext = context; }
    if (!s) { view = 'library'; renderShell(); return; }
    if (s.status === 'finished') { renderResults(); return; }
    const q = s.questions[s.index], w = wordMap.get(q.wordId), feedback = s.answers[s.index];
    if(!w){$('#page').innerHTML=unavailableStudy();return;}
    const counts = answerCounts(s.answers), hasRecall = s.questions.some(question => question.type === 'en-zh');
    const questionKey = `${s.sessionId}/${s.index}`;
    const displaySession=feedback?s:{...s,draft:inputDrafts.get(`${s.sessionId}:${s.index}`) ?? s.draft};
    motion.transitionQuestion(() => {
      $('#page').innerHTML = PracticePage({session:displaySession,word:w,feedback,counts,hasRecall,remaining:remainingTime(s,clock()),goal:goalMarkup(true)+(overview().plan?DailyPlanProgress(overview()):''),saved:state.saved.includes(w.id)});
      if ($('.question-content')) Object.assign($('.question-content').dataset,{questionKey,sessionId:s.sessionId,questionIndex:String(s.index)});
    }, !!previousQuestion && previousQuestion !== questionKey);
    reflectAccess();
    if (!$('dialog[open]')) (s.status === 'paused' ? $('.paused-state [data-action="pause"]') : q.type === 'en-zh' ? feedback ? $('#recall-next') : s.revealed ? $('#recall-ratings') : $('#reveal-meaning') : $('#answer-input'))?.focus({preventScroll:true});
  }
  function renderResults() {
    const s = state.session, counts = answerCounts(s.answers), hasRecall = s.questions.some(q => q.type === 'en-zh');
    if(s.answers.some(a=>!wordMap.has(a.wordId))){$('#page').innerHTML=unavailableStudy(true);return;}
    const wasResults = !!$('.results-panel'), focused = document.activeElement;
    $('#page').innerHTML = ResultsPage({session:s,counts,hasRecall,wordMap,dailyCount:dailyCount(state,new Date(clock())),goal:effectiveGoal(state,new Date(clock())),planContext:s.source==='daily-plan'?DailyPlanProgress(overview()):''});
    reflectAccess();
    if (!wasResults) motion.enterPage($('#page'));
    if (!$('dialog[open]')) {
      if (!wasResults) $('.results-panel h1')?.focus({preventScroll:true});
      else if (focused?.dataset.action) {
        [...document.querySelectorAll('#page [data-action]')].find(button => button.dataset.action === focused.dataset.action && button.dataset.id === focused.dataset.id)?.focus({preventScroll:true});
      }
    }
  }

  let currentUtterance;
  function speakWord(id) {
    const w = wordMap.get(id); if (!w) return;
    if (!('speechSynthesis' in window)) { toast('当前浏览器不支持语音播放，请使用桌面版 Edge 或 Chrome。'); return; }
    cancelSpeech();
    const utterance = new SpeechSynthesisUtterance(w.word);
    currentUtterance = utterance;
    utterance.lang = 'en-GB'; utterance.rate = 0.85;
    const voices = speechSynthesis.getVoices();
    utterance.voice = voices.find(v => v.lang === 'en-GB') || voices.find(v => v.lang.startsWith('en')) || null;
    const speechButtons = [...document.querySelectorAll('[data-action="speak"]')].filter(button => button.dataset.id === id);
    utterance.onstart = () => { if (currentUtterance !== utterance) return; speechButtons.forEach(button => { button.classList.add('is-speaking'); button.setAttribute('aria-busy', 'true'); motion.feedback(button.querySelector('.icon')); }); };
    utterance.onerror = event => { if (currentUtterance === utterance) clearSpeechFeedback(); if (!['interrupted','canceled'].includes(event.error)) toast('暂时无法播放，请检查系统英语语音与声音设置，或切换浏览器。'); };
    utterance.onend = () => { if (currentUtterance === utterance) { clearSpeechFeedback(); currentUtterance = null; } };
    speechSynthesis.speak(utterance);
  }
  async function leavePractice() {
    cancelSpeech();
    if(!persistenceDisabled && !await update(()=>service.pause({leave:true})))return;
    if(state.session?.source==='daily-plan')source='plan';
    view = 'library'; renderShell(); window.scrollTo(0,0);
  }
  async function navigate(nextSource, nextChapter = chapterId) {
    cancelSpeech();
    if(state.session?.status==='active' && !persistenceDisabled && !await update(()=>service.pause({leave:true})))return;
    source = nextSource; chapterId = nextChapter; view = 'library'; search = ''; filter = 'all';
    const scroll = $('.chapters')?.scrollTop || 0;
    renderShell(); $('.chapters').scrollTop = scroll; window.scrollTo(0,0);
    focusHeading();
  }
  function setNavigation(open) {
    document.body.classList.toggle('nav-open', open);
    $('.mobile-nav-toggle')?.setAttribute('aria-expanded', String(open));
    const mobile = window.matchMedia('(max-width: 900px)').matches;
    if (mobile) {
      $('.main').inert = open;
      $('.sidebar').inert = !open;
    }
    if (open) $('.mobile-nav-close')?.focus();
    else $('.mobile-nav-toggle')?.focus();
  }
  const mobileNavigation = window.matchMedia('(max-width: 900px)');
  window.matchMedia('(min-width:641px) and (max-width:1200px)').addEventListener('change',()=>{
    if(source==='plan' && view!=='practice' && !$('dialog[open]'))renderPlanContent();
  });
  mobileNavigation.addEventListener('change', () => {
    document.body.classList.remove('nav-open');
    $('.main').inert = false;
    $('.sidebar').inert = mobileNavigation.matches;
    $('.mobile-nav-toggle')?.setAttribute('aria-expanded', 'false');
  });
  document.addEventListener('click', async event => {
    const button = event.target.closest('[data-action]');
    if (!button || button.disabled || busy) return;
    const { action, id } = button.dataset;
    const identity=button.closest('.question-content')?.dataset;
    if(['skip','reveal-meaning','rate-recall','recall-next'].includes(action) &&
      (!identity || identity.sessionId!==state.session?.sessionId || Number(identity.questionIndex)!==state.session.index))return;
    if (!['toggle-nav','close-nav','reload','close-dialog','speak','detail','about','filter','clear-filter','home','chapter','nav','plan-settings','plan-content','reveal-plan-word'].includes(action) && !checkStorage()) { event.preventDefault(); toast(storageWarning); return; }
    busy=true;
    try {switch (action) {
      case 'toggle-nav': setNavigation(true); break;
      case 'close-nav': setNavigation(false); break;
      case 'reload': location.reload(); break;
      case 'home': event.preventDefault(); await navigate('chapter'); break;
      case 'chapter': await navigate('chapter', id); break;
      case 'nav': await navigate(button.dataset.source); break;
      case 'filter': setFilter(id); break;
      case 'clear-filter': search = ''; $('#word-search').value = ''; setFilter('all'); $('#word-search').focus({preventScroll:true}); break;
      case 'detail': showWord(id); break;
      case 'close-dialog': closeDialog(true, true); break;
      case 'goal': showGoal(); break;
      case 'about': showAbout(); break;
      case 'speak': speakWord(id); break;
      case 'save-word': await toggleSaved(id); break;
      case 'plan-settings':showPlanSettings();break;
      case 'reveal-plan-word': {
        if(source!=='plan' || view==='practice' || !overview().plan?.items.some(item=>item.wordId===id && item.kind==='review'))break;
        planContent.revealed.add(id);renderPlanContent();
        [...document.querySelectorAll('.word-link')].find(button=>button.dataset.id===id)?.focus({preventScroll:true});
        break;
      }
      case 'plan-content': {
        const {kind,command,page}=button.dataset;
        if(source!=='plan' || view==='practice' || !['review','new'].includes(kind))break;
        if(command==='hide')planContent.revealed.clear();
        else if(command==='collapse')planContent[kind]={};
        else if(['all','pending'].includes(command))planContent[kind]={scope:command,expanded:true,page:0};
        else if(['next','previous'].includes(command))planContent[kind]={...planContent[kind],page:Number(page)+(command==='next'?1:-1)};
        else break;
        renderPlanContent();$(`#task-${kind}`)?.focus({preventScroll:!['next','previous'].includes(command)});
        break;
      }
      case 'retry-save': {
        const retry=pendingSave?.action;
        if(retry && await update(retry)) {closeDialog(false);renderPage();updateCounts();if(view!=='practice')focusHeading();toast('已保存。');}
        break;
      }
      case 'start-plan': {
        const kind=button.dataset.kind ?? 'all';
        if(state.session?.status!=='finished' && state.session?.planId===overview().plan?.planId && state.session?.planKind===kind) {
          if(await update(()=>service.resume())){view='practice';renderShell();window.scrollTo(0,0);}
        } else openDialog(PlanPracticeSettings({kind,hasUnfinished:!!state.session && state.session.status!=='finished'}),'plan-practice-modal');
        break;
      }
      case 'claim-extra':
        if(await update(()=>service.claimExtra(20))){renderPage();toast('已领取额外到期词，基础计划保持不变。');}break;
      case 'remove-mistake': {
        const buttons = [...document.querySelectorAll('[data-action="remove-mistake"]')];
        const position = buttons.indexOf(button);
        if(!await update(()=>service.removeMistake(id)))break;
        updateCounts(); renderCards();
        const remaining = [...document.querySelectorAll('[data-action="remove-mistake"]')];
        (remaining[Math.min(position, remaining.length - 1)] || $('#word-search'))?.focus({preventScroll:true});
        toast('已移出错题本'); break;
      }
      case 'setup': openSetup(button.dataset.multi === 'true'); break;
      case 'resume':
        if(!await update(()=>service.resume()))break;
        source = state.session.source==='daily-plan'?'plan':state.session.source || 'chapter';
        if (state.session.chapterIds?.some(id => chapterWords.has(id))) chapterId = state.session.chapterIds.find(id => chapterWords.has(id));
        view = 'practice'; renderShell(); window.scrollTo(0,0); break;
      case 'leave-practice': await leavePractice(); break;
      case 'pause': if(await update(()=>service.pause())){window.speechSynthesis?.cancel();renderPractice();}break;
      case 'skip': await submitAnswer('', true,identity); break;
      case 'reveal-meaning':
        if(await update(()=>service.reveal(id)))renderPractice();break;
      case 'rate-recall': {
        const request={sessionId:identity.sessionId,questionIndex:Number(identity.questionIndex),rating:button.dataset.rating};
        if(await update(()=>service.submit(request))) {updateCounts();renderPractice();}break;
      }
      case 'recall-next':
        if(await update(()=>service.next()))renderPractice();break;
      case 'end-round':
        if(!await update(()=>service.settle()))break;
        if(state.session.status==='finished'){renderPractice();break;}
        if(!await update(()=>service.pause({leave:true})))break;
        renderPractice();
        openDialog(`${dialogHeading('结束本轮练习？')}<p class="modal-intro">已答记录保留，未答题不计错。</p><div class="modal-actions"><button class="button secondary" data-action="close-dialog">暂不结束</button><button class="button primary" data-action="confirm-end">结束并查看结果</button></div>`, 'small-modal'); break;
      case 'confirm-end': if(await update(()=>service.finish())){closeDialog();renderPractice();}break;
      case 'review-round': {
        const words = state.session.answers.filter(a => !a.correct).map(a => wordMap.get(a.wordId)).filter(Boolean);
        if(!await update(()=>service.startOrdinary(words,{ count: 'all', mode: state.session.mode, source: 'mistakes', label: '本轮待巩固词复习', timed: false })))break;
        source = 'mistakes'; search = ''; filter = 'all';
        renderShell(); window.scrollTo(0,0); break;
      }
    }} finally {busy=false;}
  });
  async function submitAnswer(input, skipped = false, identity) {
    const s = state.session;
    if (!s || s.status !== 'active') return;
    if(!identity || identity.sessionId!==s.sessionId || Number(identity.questionIndex)!==s.index)return;
    if(!await update(()=>service.settle()))return;
    if(state.session.status==='finished'){renderPractice();return;}
    if (s.answers.length > s.index) { if(await update(()=>service.next()))renderPractice();return; }
    if (!skipped && !input.trim()) { toast('请输入答案或选择跳过。'); $('#answer-input')?.focus(); return; }
    if(await update(()=>service.submit({sessionId:s.sessionId,questionIndex:s.index,input,skipped}))) {updateCounts();renderPractice();}
  }
  document.addEventListener('submit', async event => {
    event.preventDefault();
    if(busy)return;
    if (!checkStorage()) { event.preventDefault(); toast(storageWarning); return; }
    busy=true;
    try {if (event.target.id === 'goal-form') {
      event.preventDefault();
      const goal = Number(new FormData(event.target).get('goal'));
      if (!Number.isInteger(goal) || goal < 1 || goal > 2000) return;
      if(await update(()=>service.setGoal(goal))){closeDialog(false);renderPage();focusHeading();toast(state.srs.dailyPlans[today()]?'每日目标已保存，下个学习日生效。':'每日目标已更新。');}
    } else if(event.target.id==='daily-plan-form') {
      const form=new FormData(event.target),configuration={goal:Number(form.get('goal')),chapterIds:form.getAll('chapters'),mode:form.get('selection')};
      const hadPlan=Boolean(overview().plan);
      if(await update(async()=>{await service.configure(configuration);if(!hadPlan)await service.generate();})) {
        closeDialog(false);renderPage();focusHeading();toast(hadPlan?'设置已保存，将从下一个学习日生效。':'今日计划已生成。');
      }
    } else if(event.target.id==='plan-practice-form') {
      const kind=event.target.dataset.kind,mode=new FormData(event.target).get('mode');
      if(await update(()=>service.startPlan(kind,{mode,replace:true}))) {closeDialog();source='plan';view='practice';renderShell();window.scrollTo(0,0);}
    } else if (event.target.id === 'practice-form') {
      event.preventDefault();
      const form = new FormData(event.target);
      const options = { source: settingsDraft.source, mode: form.get('mode'), count: form.get('count'), timed: form.has('timed'), minutes: form.get('minutes') || 10, label: settingsDraft.source === 'chapter' ? settingsDraft.chapters.length === 1 ? dataset.chapters.find(c => c.id === settingsDraft.chapters[0]).name : `${settingsDraft.chapters.length} 章混合练习` : settingsDraft.source === 'saved' ? '生词本复习' : '错题本复习' };
      options.chapterIds = [...settingsDraft.chapters];
      Object.assign(settingsDraft, options);
      if(!await update(()=>service.startOrdinary(setupWords(),options)))return;
      closeDialog(); view = 'practice'; renderShell(); window.scrollTo(0,0);
    } else if (event.target.id === 'answer-form') {
      await submitAnswer($('#answer-input').value,false,event.target.closest('.question-content')?.dataset);
    }
    } finally {busy=false;}
  });
  document.addEventListener('input', async event => {
    if (event.target.id === 'word-search') { search = event.target.value; renderCards(); }
    if (event.target.id === 'word-note') {
      const {value}=event.target,id=event.target.dataset.id;
      if($('#note-status'))$('#note-status').textContent='正在保存';
      const saved=await update(()=>service.note(id,value),{quiet:true,key:`note:${id}`});
      if($('#note-status'))$('#note-status').textContent=saved?'已保存在本机':'未保存，请保留输入并重试';
    }
    if (event.target.id === 'answer-input' && state.session && state.session.answers.length === state.session.index) {
      const {sessionId,index}=state.session,text=event.target.value;
      inputDrafts.set(`${sessionId}:${index}`,text);
      await update(()=>service.draft(sessionId,index,text),{quiet:true,key:`draft:${sessionId}:${index}`});
    }
  });
  document.addEventListener('change', event => {
    if(event.target.closest('#daily-plan-form')) {
      const ids=new FormData($('#daily-plan-form')).getAll('chapters');
      const {available}=service?service.configurationOptions(ids):planConfigurationOptions(state,dataset,clock(),ids);
      $('#plan-pool-count').textContent=`已选 ${ids.length} 章 · 未学 ${available} 词`;
      return;
    }
    if (!event.target.closest('#practice-form')) return;
    const form = new FormData($('#practice-form'));
    settingsDraft.chapters = form.getAll('chapters');
    settingsDraft.count = form.get('count'); settingsDraft.mode = form.get('mode'); settingsDraft.timed = form.has('timed');
    settingsDraft.minutes = form.get('minutes') || settingsDraft.minutes;
    $('[name="minutes"]').disabled = !settingsDraft.timed;
    const size = setupWords().length;
    $('#pool-count').textContent = `已选 ${size} 词`;
    $('#round-size').textContent = `本轮 ${settingsDraft.count === 'all' ? size : Math.min(size, Number(settingsDraft.count))} 题`;
    $('#start-round').disabled = !size;
  });
  document.addEventListener('keydown', event => {
    const filterButton=event.target.closest?.('.filter-tabs button');
    if(filterButton && ['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) {
      event.preventDefault();
      const buttons=[...filterButton.parentElement.querySelectorAll('button')],index=buttons.indexOf(filterButton);
      const next=event.key==='Home'?0:event.key==='End'?buttons.length-1:(index+(event.key==='ArrowRight'?1:-1)+buttons.length)%buttons.length;
      buttons[next].focus();buttons[next].click();return;
    }
    if (document.body.classList.contains('nav-open')) {
      if (event.key === 'Escape') { event.preventDefault(); setNavigation(false); return; }
      if (event.key === 'Tab') {
        const items = [...$('.sidebar').querySelectorAll('a,button')].filter(el => el.getClientRects().length && !el.disabled);
        const first = items[0], last = items[items.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
      return;
    }
    if ((event.isComposing || event.repeat) && event.key === 'Enter') { event.preventDefault(); return; }
    if (event.isComposing || event.repeat || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || event.target.closest('input,textarea,select,[contenteditable="true"]') || $('dialog[open]')) return;
    if (event.key === '/' && $('#word-search')) { event.preventDefault(); $('#word-search').focus(); return; }
    const rating = ({'1':'wrong','2':'fuzzy','3':'correct'})[event.key];
    const button = rating && view === 'practice' && $(`[data-action="rate-recall"][data-rating="${rating}"]`);
    if (button) { event.preventDefault(); button.click(); }
  });
  async function settleExpiredSession() {
    if(busy || persistenceDisabled || storageConflict)return;
    const expired=state.session?.status==='active' && state.session.timed && remainingTime(state.session,clock())===0;
    const crossed=lastDate!==today();
    if(!expired && !crossed)return;
    busy=true;
    try {
    if(!await update(()=>service.settle(),{quiet:true}))return;
    if(crossed){lastDate=today();pendingDateRefresh=true;}
    if(source==='plan' && view!=='practice') {if(!$('dialog[open]'))renderPage();return;}
    if (view === 'practice') {
      renderPractice();
      if ($('dialog[open]') && expired) toast('本轮计时已结束，结果已结算。可继续编辑，再关闭弹窗查看。');
    } else {
      const slot = $('#resume-slot');
      if (slot) {
        slot.innerHTML = resumeMarkup();
        if (!$('.last-result')) $('.chapter-heading')?.insertAdjacentHTML('beforeend', lastResultMarkup());
      }
    }
    }finally {busy=false;}
  }
  document.addEventListener('visibilitychange', settleExpiredSession);
  setInterval(() => {
    settleExpiredSession();
    const timer = $('#round-timer');
    if (timer && state.session?.timed) { timer.textContent = formatTime(remainingTime(state.session,clock())); timer.closest('.timer-chip').classList.toggle('urgent', remainingTime(state.session,clock()) < 60000); }
    if (pendingDateRefresh && !$('dialog[open]')) {
      pendingDateRefresh = false;
      document.querySelectorAll('.daily-goal').forEach(goal=>{goal.outerHTML=goalMarkup(goal.classList.contains('compact'));});
      document.querySelectorAll('[data-daily-plan]').forEach(plan=>{plan.outerHTML=DailyPlanProgress(dailyOverview(state,dataset,clock()));});
      if ($('#word-grid')) {
        const focused = document.activeElement;
        const { action, id } = focused?.dataset || {};
        renderCards();
        if (action && !focused.isConnected) {
          const nextFocus = [...document.querySelectorAll('[data-action]')].find(button => button.dataset.action === action && button.dataset.id === id);
          (nextFocus || $('#word-search'))?.focus({preventScroll:true});
        }
      }
      if (view === 'practice' && state.session?.status === 'finished') renderResults();
    }
  }, 500);
  window.addEventListener('storage', event => { if (event.key === STORAGE_KEY || event.key === null) checkStorage(); });
  renderShell();

}
