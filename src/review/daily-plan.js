import { shuffle } from '../core.js';
import { learningDay, addDays, isDue, assertDay } from './calendar.js';

const compare = (a,b) => a < b ? -1 : a > b ? 1 : 0;
const wordsOf = dataset => {
  const words=new Map();
  for(const word of dataset.words) {
    const previous=words.get(word.id);
    words.set(word.id,previous ? {...previous,chapters:[...new Set([...previous.chapters,...word.chapters])]} : {...word,chapters:[...word.chapters]});
  }
  return [...words.values()];
};
export function datasetRevision(dataset) {
  // A structural fingerprint, not a data format version or a cryptographic ID.
  let hash=2166136261;
  for (const char of JSON.stringify(wordsOf(dataset).map(w=>[w.id,w.chapters]))) {
    hash=Math.imul(hash ^ char.charCodeAt(0),16777619) >>> 0;
  }
  return `words-${hash.toString(16)}`;
}

export function dueWords(state,dataset,day) {
  assertDay(day);
  const available=new Set(dataset.words.map(w=>w.id));
  return Object.values(state.srs.memories).filter(m=>available.has(m.wordId) && isDue(m.nextReviewAt,day))
    .sort((a,b)=>compare(a.nextReviewAt,b.nextReviewAt) || b.lapseCount-a.lapseCount || compare(a.wordId,b.wordId));
}

export function validatePlanSettings(settings,dataset) {
  if (!settings || !Array.isArray(settings.chapterIds) || settings.chapterIds.some(id=>!dataset.chapters.some(c=>c.id===id)) ||
      !['ordered','random'].includes(settings.mode)) throw new Error('请选择有效章节和选词方式');
  return {chapterIds:[...new Set(settings.chapterIds)],mode:settings.mode};
}

// Shared read-only candidate query for generation and the configuration view.
export function newWordCandidates(state,dataset,day,chapterIds,excludeIds=[]) {
  const excluded=new Set([...Object.keys(state.srs.memories),...state.srs.legacyLearnedIds,...(state.daily[day] || []),...excludeIds]);
  return wordsOf(dataset).filter(w=>w.chapters.some(id=>chapterIds.includes(id)) && !excluded.has(w.id));
}

export function generateDailyPlan(state,dataset,{now,settings=state.srs.planSettings ?? {chapterIds:[],mode:'ordered'},random=Math.random}={}) {
  const day=learningDay(now,state.srs.timeZone);
  if (Object.hasOwn(state.srs.dailyPlans,day)) return state.srs.dailyPlans[day];
  const newWordSource=validatePlanSettings(settings,dataset);
  const today=[...new Set(state.daily[day] || [])];
  const completed=new Set(today), due=dueWords(state,dataset,day), dueIds=new Set(due.map(m=>m.wordId));
  const items=today.map(wordId=>({wordId,kind:!dueIds.has(wordId) && state.srs.memories[wordId]?.origin==='practice' &&
    learningDay(state.srs.memories[wordId].introducedAt,state.srs.timeZone)===day ? 'new':'review',state:'completed'}));
  const pendingDue=due.filter(m=>!completed.has(m.wordId)).slice(0,Math.max(0,state.goal-items.length));
  items.push(...pendingDue.map(m=>({wordId:m.wordId,kind:'review',state:'pending'})));
  let pool=newWordCandidates(state,dataset,day,newWordSource.chapterIds,items.map(i=>i.wordId));
  if (newWordSource.mode==='random') pool=shuffle(pool,random);
  items.push(...pool.slice(0,Math.max(0,state.goal-items.length)).map(w=>({wordId:w.id,kind:'new',state:'pending'})));
  return {planId:`daily:${day}`,dayKey:day,timeZone:state.srs.timeZone,generatedAt:now,updatedAt:now,
    algorithmVersion:state.srs.algorithmVersion,datasetRevision:datasetRevision(dataset),goalSnapshot:state.goal,
    newWordSource,items,extraItems:[],status:items.every(i=>i.state==='completed')?'completed':'ready'};
}

export function extraReviewCandidates(state,dataset,day) {
  const plan=state.srs.dailyPlans[day], assigned=new Set(plan ? [...plan.items,...plan.extraItems].map(i=>i.wordId) : []);
  const done=new Set(state.daily[day] || []);
  return dueWords(state,dataset,day).filter(m=>!assigned.has(m.wordId) && !done.has(m.wordId));
}

// Mutators operate only on repository candidate snapshots, never a second store.
export function synchronizePlans(state,dataset,now) {
  const day=learningDay(now,state.srs.timeZone), available=new Set(dataset.words.map(w=>w.id));
  for (const plan of Object.values(state.srs.dailyPlans)) {
    let changed=false;
    for (const item of [...plan.items,...plan.extraItems]) if (item.state!=='completed') {
      const next=available.has(item.wordId)?'pending':'unavailable';
      if(item.state!==next){item.state=next;changed=true;}
    }
    const session=state.session;
    const status=plan.dayKey < day ? 'archived' : plan.items.every(i=>i.state==='completed') ? 'completed'
      : session?.planId===plan.planId && session.status!=='finished' ? session.status : 'ready';
    if(status!==plan.status){plan.status=status;changed=true;}
    if(changed)plan.updatedAt=now;
  }
  // Archive old details while retaining counts and all original daily/stats data.
  const cutoff=addDays(day,-29); // Today plus the previous 29 learning days.
  state.srs.planArchive ??= Object.create(null);
  for (const [key,plan] of Object.entries(state.srs.dailyPlans)) if(key<cutoff && state.session?.planId!==plan.planId) {
    state.srs.planArchive[key]={planId:plan.planId,goalSnapshot:plan.goalSnapshot,
      ...planCounts(plan),archivedAt:now};
    delete state.srs.dailyPlans[key];
  }
}

export function completePlanWord(state,wordId,now) {
  const day=learningDay(now,state.srs.timeZone);
  for (const plan of Object.values(state.srs.dailyPlans)) {
    if (plan.dayKey!==day && plan.planId!==state.session?.planId) continue;
    for (const item of [...plan.items,...plan.extraItems]) if(item.wordId===wordId && item.state!=='completed') {
      item.state='completed';plan.updatedAt=now;
    }
    if(plan.dayKey<day)plan.status='archived';
    else if(plan.items.every(i=>i.state==='completed'))plan.status='completed';
  }
}

export function planCounts(plan) {
  const count=(kind,done=false)=>plan.items.filter(i=>i.kind===kind && (!done || i.state==='completed')).length;
  return {review:count('review'),new:count('new'),completedReview:count('review',true),completedNew:count('new',true),
    completed:plan.items.filter(i=>i.state==='completed').length,total:plan.items.length,
    unavailable:plan.items.filter(i=>i.state==='unavailable').length,
    extra:plan.extraItems.length,completedExtra:plan.extraItems.filter(i=>i.state==='completed').length,
    pendingReview:plan.items.filter(i=>i.kind==='review' && i.state==='pending').length,
    pendingNew:plan.items.filter(i=>i.kind==='new' && i.state==='pending').length,
    pendingExtra:plan.extraItems.filter(i=>i.state==='pending').length,
    shortage:Math.max(0,plan.goalSnapshot-plan.items.length)};
}

export function dailyOverview(state,dataset,now) {
  const day=learningDay(now,state.srs.timeZone),plan=state.srs.dailyPlans[day];
  return {day,plan,counts:plan ? planCounts(plan):null,
    todayCount:new Set(state.daily[day] || []).size,backlog:extraReviewCandidates(state,dataset,day).length};
}
