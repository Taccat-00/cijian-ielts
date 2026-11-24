import { startSession, recordAnswer, recordSelfAssessment, revealMeaning, nextQuestion,
  togglePause, expireSession, finishSession } from '../core.js';
import { newSessionId } from './schema.js';
import { learningDay, assertTimestamp, isDue } from './calendar.js';
import { practiceEvent, evaluateMemory } from './engine.js';
import { generateDailyPlan, validatePlanSettings, synchronizePlans, completePlanWord,
  extraReviewCandidates, dailyOverview, newWordCandidates } from './daily-plan.js';

export function planConfigurationOptions(state,dataset,now,chapterIds=[]) {
  const day=learningDay(now,state.srs.timeZone);
  return {chapters:dataset.chapters.map(chapter=>({...chapter,available:newWordCandidates(state,dataset,day,[chapter.id]).length})),
    available:newWordCandidates(state,dataset,day,chapterIds).length};
}
export function wordReviewStates(state,now) {
  const day=learningDay(now,state.srs.timeZone),result=Object.create(null);
  for(const [id,memory] of Object.entries(state.srs.memories))result[id]={due:isDue(memory.nextReviewAt,day),nextReviewAt:memory.nextReviewAt};
  return result;
}

export function createLearningService(repository,dataset,{clock=Date.now,random=Math.random,idFactory=newSessionId}={}) {
  const wordMap=new Map(dataset.words.map(w=>[w.id,w]));
  function reconcile(state,now) {
    assertTimestamp(now);
    const latest=Object.values(state.srs.memories).reduce((at,m)=>Math.max(at,m.lastReviewedAt ?? 0),state.srs.activatedAt);
    if(now<latest)throw Object.assign(new Error('学习时钟回退，请校时后重试'),{code:'CLOCK_ROLLBACK'});
    synchronizePlans(state,dataset,now);
    const day=learningDay(now,state.srs.timeZone);
    if(state.srs.planSettings && !Object.hasOwn(state.srs.dailyPlans,day)) {
      // Removed chapters cannot silently redirect new words to another chapter.
      const settings={...state.srs.planSettings,chapterIds:state.srs.planSettings.chapterIds.filter(id=>dataset.chapters.some(c=>c.id===id))};
      state.srs.dailyPlans[day]=generateDailyPlan(state,dataset,{now,settings,random});
    }
  }
  const transaction = (reducer, options) => repository.transact(state=>{
    const now=clock();reconcile(state,now);reducer(state,now);synchronizePlans(state,dataset,now);
  },options);
  function makeSession(words,options,now,ordered=false) {
    const session={...startSession(words,options,now,random),sessionId:idFactory()};
    if(ordered)session.questions.forEach((q,index)=>{q.wordId=words[index].id;});
    return session;
  }
  function planForSession(state) {
    const session=state.session;
    return session?.planDayKey ? state.srs.dailyPlans[session.planDayKey] : null;
  }
  return {
    snapshot:()=>repository.snapshot(),
    overview:()=>dailyOverview(repository.snapshot(),dataset,clock()),
    configurationOptions:chapterIds=>planConfigurationOptions(repository.snapshot(),dataset,clock(),chapterIds),
    reviewStates:()=>wordReviewStates(repository.snapshot(),clock()),
    async settle() {
      const state=repository.snapshot(),before=JSON.stringify(state),now=clock();
      const day=learningDay(now,state.srs.timeZone);
      if(state.srs.planSettings && !Object.hasOwn(state.srs.dailyPlans,day)) {
        // Draw a new random plan only inside its actual commit, not in a preview.
        return transaction((candidate,at)=>{if(candidate.session)expireSession(candidate.session,at);});
      }
      reconcile(state,now);if(state.session)expireSession(state.session,now);
      if(JSON.stringify(state)!==before)return transaction((candidate,at)=>{if(candidate.session)expireSession(candidate.session,at);});
      return state;
    },
    configure({goal,chapterIds,mode}) {
      const settings=validatePlanSettings({chapterIds,mode},dataset);
      if(!Number.isInteger(goal) || goal<1 || goal>2000)throw new Error('每日目标必须为1至2000的整数');
      // Settle the old configuration first, then save tomorrow's configuration.
      return transaction(state=>{state.goal=goal;state.srs.planSettings=settings;});
    },
    generate(settings) {
      if(settings)validatePlanSettings(settings,dataset);
      return transaction((state,now)=>{
        const day=learningDay(now,state.srs.timeZone);
        if(settings)state.srs.planSettings=validatePlanSettings(settings,dataset);
        if(!Object.hasOwn(state.srs.dailyPlans,day))state.srs.dailyPlans[day]=generateDailyPlan(state,dataset,{now,random});
      });
    },
    startOrdinary(words,options) {
      return transaction((state,now)=>{state.session=makeSession(words,options,now);});
    },
    startPlan(kind='all',{mode='en-zh',dayKey,replace=false}={}) {
      if(!['all','review','new','extra'].includes(kind))throw new Error('计划练习范围无效');
      return transaction((state,now)=>{
        const day=dayKey ?? learningDay(now,state.srs.timeZone),plan=state.srs.dailyPlans[day];
        if(!plan)throw new Error('请先生成每日计划');
        if(state.session?.status!=='finished' && state.session) {
          expireSession(state.session,now);
          if(state.session.status!=='finished') {
            if(state.session.planId===plan.planId && state.session.planKind===kind) {
              if(state.session.questions.some(q=>!wordMap.has(q.wordId)))throw new Error('当前词库缺少原会话词汇，请恢复词库后继续');
              if(state.session.status==='paused')togglePause(state.session,now);
              if(day===learningDay(now,state.srs.timeZone)){plan.status='active';plan.updatedAt=now;}
              return;
            }
            if(!replace)throw new Error('当前有未完成练习；请继续原轮，或明确替换后再开始');
          }
        }
        const items=kind==='extra'?plan.extraItems:plan.items;
        const words=items.filter(i=>i.state==='pending' && (['all','extra'].includes(kind) || i.kind===kind)).map(i=>wordMap.get(i.wordId)).filter(Boolean);
        if(!words.length)throw new Error('当前范围没有可练习的待完成词汇');
        const session=makeSession(words,{source:'daily-plan',label:`${day} ${kind==='new'?'新词学习':kind==='review'?'到期复习':kind==='extra'?'额外复习':'每日计划'}`,
          mode,count:'all',timed:false,chapterIds:plan.newWordSource.chapterIds},now,true);
        state.session={...session,planId:plan.planId,planDayKey:day,planKind:kind};
        if(day===learningDay(now,state.srs.timeZone))plan.status='active';plan.updatedAt=now;
      });
    },
    claimExtra(count=20) {
      if(!Number.isInteger(count)||count<1||count>2000)throw new Error('额外复习数量无效');
      return transaction((state,now)=>{
        const day=learningDay(now,state.srs.timeZone),plan=state.srs.dailyPlans[day];
        if(!plan)throw new Error('请先生成每日计划');
        plan.extraItems.push(...extraReviewCandidates(state,dataset,day).slice(0,count).map(m=>({wordId:m.wordId,kind:'review',state:'pending'})));
        plan.updatedAt=now;
      });
    },
    submit({sessionId,questionIndex,input='',skipped=false,rating}) {
      return transaction((state,now)=>{
        const q=state.session.questions[questionIndex],word=wordMap.get(q.wordId);
        if(!word)throw new Error('当前词库缺少本题词汇，原会话已保留，请恢复词库后继续');
        const answer=q.type==='en-zh' ? recordSelfAssessment(state,q.wordId,rating,now) : recordAnswer(state,word,input,skipped,now);
        if(!answer)throw new Error('本题尚不能提交，请检查答案、释义状态或计时');
        const event=practiceEvent(state.session,questionIndex);
        if(event) {
          const result=evaluateMemory(state.srs.memories[q.wordId],event,state.srs.timeZone);
          if(!result.accepted)throw new Error('记忆事件已存在，提交已停止');
          state.srs.memories[q.wordId]=result.memory;
          completePlanWord(state,q.wordId,now);
        }
      },{event:{sessionId,questionIndex}});
    },
    reveal(wordId) {return transaction((state,now)=>{if(!revealMeaning(state.session,wordId,now))throw new Error('当前题目不能显示释义');});},
    next() {return transaction((state,now)=>{if(state.session)nextQuestion(state.session,now);});},
    pause({leave=false}={}) {return transaction((state,now)=>{
      if(state.session && (!leave || state.session.status==='active'))togglePause(state.session,now);
      const plan=planForSession(state);
      if(plan && plan.dayKey===learningDay(now,state.srs.timeZone) && plan.status!=='completed') {
        plan.status=state.session.status==='paused'?'paused':state.session.status==='finished'?'ready':'active';plan.updatedAt=now;
      }
    });},
    resume() {return transaction((state,now)=>{
      if(!state.session)throw new Error('没有可恢复的练习');
      if(state.session.questions.some(q=>!wordMap.has(q.wordId)))throw new Error('当前词库缺少原会话词汇；记录已保留，请恢复词库后继续');
      if(state.session.status==='paused')togglePause(state.session,now);
      expireSession(state.session,now);
      const plan=planForSession(state);if(plan && plan.dayKey===learningDay(now,state.srs.timeZone) && plan.status!=='completed'){plan.status='active';plan.updatedAt=now;}
    });},
    finish() {return transaction((state,now)=>{if(state.session)finishSession(state.session,'manual',now);});},
    setGoal(goal) {
      if(!Number.isInteger(goal)||goal<1||goal>2000)throw new Error('每日目标无效');
      return transaction(state=>{state.goal=goal;});
    },
    toggleSaved(wordId) {return transaction(state=>{
      if(!wordMap.has(wordId))throw new Error('单词不存在');
      state.saved=state.saved.includes(wordId)?state.saved.filter(id=>id!==wordId):[...state.saved,wordId];
    });},
    removeMistake(wordId) {return transaction(state=>{delete state.mistakes[wordId];});},
    note(wordId,text) {return transaction(state=>{
      if(!wordMap.has(wordId))throw new Error('单词不存在');
      if(text)state.notes[wordId]=text;else delete state.notes[wordId];
    });},
    draft(sessionId,index,text) {return transaction(state=>{
      const session=state.session;
      if(session?.sessionId===sessionId && session.index===index && session.answers.length===index)session.draft=text;
    });}
  };
}
