import { initialState, readState } from '../core.js';
import { assertDay, assertTimestamp, assertTimeZone, deviceTimeZone, learningDay } from './calendar.js';
import { ALGORITHM_VERSION, GRADES, EFFECTS, eventId, emptyHistorySummary } from './engine.js';
// Frozen old invariants are used ONLY to validate imported historical records.
import { INTERVALS, scheduleFromBaseline } from './legacy-engine.js';
import { FSRS_CONFIG, restoreCard, memorySchedule, assertFSRSLog, scheduleFSRS } from './fsrs.js';

export const STATE_VERSION = 2;
export const BACKUP_KEY = 'cijian.ielts.backup.v1';
export const FSRS_BACKUP_KEY = 'cijian.ielts.backup.pre-fsrs.v2';
const fail = message => { throw new Error(message); };
const object = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const sameFields = (a,b) => object(a) && object(b) && Object.keys(a).length === Object.keys(b).length &&
  Object.keys(b).every(key=>Object.hasOwn(a,key) && a[key]===b[key]);
const text = v => typeof v === 'string' && v.trim().length > 0;
const uint = v => Number.isSafeInteger(v) && v >= 0;
const dict = v => Object.assign(Object.create(null), v);
const uniqueStrings = a => Array.isArray(a) && a.every(text) && new Set(a).size === a.length;
const nullableTime = at => { if (at !== null) assertTimestamp(at); };

function assertJSON(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number' && Number.isFinite(value)) return;
  if (!object(value) && !Array.isArray(value)) fail('状态必须是可序列化的 JSON 数据');
  if (![Object.prototype, Array.prototype, null].includes(Object.getPrototypeOf(value))) fail('状态对象类型无效');
  for (const item of Array.isArray(value) ? value : Object.values(value)) assertJSON(item);
}

export function newSessionId() {
  if (!globalThis.crypto?.randomUUID) fail('当前环境不能生成安全的练习标识');
  return globalThis.crypto.randomUUID();
}

// Validate legacy fields without filtering IDs against a temporary demo dataset.
function validateLegacy(data) {
  if (!object(data) || !Array.isArray(data.saved) || !data.saved.every(text)) fail('旧版收藏记录损坏');
  const ids = new Set(data.session?.questions?.map?.(q => q?.wordId) || []);
  const legacy = { ...data, version: 1 };
  if (legacy.session?.source === 'daily-plan' && data.version === 2) legacy.session = { ...legacy.session, source: 'chapter' };
  const checked = readState(JSON.stringify(legacy), ids);
  if (data.session !== null && checked.session === null) fail('练习会话损坏，迁移已停止');
  if (data.session !== null) {
    assertTimestamp(data.session.startedAt);
    if (data.session.deadline !== null) assertTimestamp(data.session.deadline);
    for (const answer of data.session.answers) assertTimestamp(answer.at);
  }
  for (const day of Object.keys(data.daily)) assertDay(day);
  for (const key of ['mistakes', 'notes', 'stats']) if (Object.keys(data[key]).some(id => !text(id))) fail('旧版单词标识损坏');
  if (Object.values(data.daily).some(ids => !ids.every(text))) fail('旧版每日记录损坏');
  for (const stats of Object.values(data.stats)) if (!uint(stats.attempts) || !uint(stats.correct)) fail('旧版练习统计损坏');
  for (const mistake of Object.values(data.mistakes)) {
    assertTimestamp(mistake.lastAt);
    if (!Number.isSafeInteger(mistake.count)) fail('旧版错题次数损坏');
  }
}

function assertSchedule(m, allowZero) {
  if (!object(m) || !['learning', 'review', 'relearning'].includes(m.status) || !uint(m.repetition) || m.repetition > 5 ||
      !uint(m.intervalDays) || m.intervalDays > 30 || (!allowZero && m.intervalDays === 0) || !uint(m.lapseCount)) fail('记忆调度字段损坏');
  assertDay(m.nextReviewAt);
  if ((m.status === 'review' && m.repetition < 2) || (m.status !== 'review' && m.repetition > 1) ||
      (m.status === 'relearning' && m.repetition !== 0)) fail('记忆状态与阶段不一致');
  if (m.repetition > 0 && m.intervalDays !== INTERVALS[m.repetition-1]) fail('记忆间隔与阶段不一致');
}

function assertHistoryEvent(e, wordId, timeZone) {
  if (!object(e) || e.wordId !== wordId || e.eventId !== eventId(e.sessionId,e.questionIndex) ||
      !['zh-en','en-zh','listening'].includes(e.type) || !['chapter','saved','mistakes','daily-plan'].includes(e.source) ||
      !GRADES.includes(e.grade) || !EFFECTS.includes(e.schedulingEffect) || ![1,ALGORITHM_VERSION].includes(e.algorithmVersion)) fail('学习历史损坏');
  if (e.dayKey !== learningDay(e.at,timeZone)) fail('学习事件日期与时区不一致');
}

function assertMemory(m, wordId, timeZone) {
  if (m?.algorithmVersion === ALGORITHM_VERSION) return assertFSRSMemory(m,wordId,timeZone);
  if (!text(wordId) || !object(m) || m.wordId !== wordId || !['practice','legacy'].includes(m.origin) ||
      m.algorithmVersion !== 1) fail('记忆标识或版本损坏');
  assertSchedule(m,m.origin === 'legacy' && m.lastReviewedAt === null);
  nullableTime(m.lastReviewedAt); nullableTime(m.introducedAt);
  if (m.origin === 'practice' && (m.introducedAt === null || m.lastReviewedAt === null)) fail('新学习记录缺少时间');
  if (m.introducedAt !== null && m.lastReviewedAt < m.introducedAt) fail('记忆时间顺序损坏');
  if (!Array.isArray(m.learningHistory) || m.learningHistory.length > 20) fail('学习历史超出限制');
  const ids = new Set(); let lastAt = -1;
  for (const e of m.learningHistory) {
    assertHistoryEvent(e,wordId,timeZone);
    if (ids.has(e.eventId) || e.at < lastAt) fail('学习历史重复或乱序');
    ids.add(e.eventId); lastAt=e.at;
  }
  const summary=m.historySummary;
  if (!object(summary) || !uint(summary.count) || !object(summary.grades) || !GRADES.every(g=>uint(summary.grades[g])) ||
      GRADES.reduce((n,g)=>n+summary.grades[g],0) !== summary.count) fail('历史摘要损坏');
  nullableTime(summary.firstAt); nullableTime(summary.lastAt);
  if (summary.count === 0 ? summary.firstAt !== null || summary.lastAt !== null
    : summary.firstAt === null || summary.lastAt === null || summary.firstAt > summary.lastAt ||
      (m.learningHistory.length && summary.lastAt > m.learningHistory[0].at)) fail('历史摘要时间损坏');
  const evaluation=m.dayEvaluation;
  if (evaluation === null) {
    if (m.origin !== 'legacy' || m.lastReviewedAt !== null || m.learningHistory.length || summary.count ||
        m.intervalDays !== 0 || m.repetition !== 0 || m.status !== 'learning' || m.lapseCount !== 0) fail('未评估迁移记录损坏');
    return;
  }
  if (!object(evaluation) || !GRADES.includes(evaluation.worstGrade) || !uniqueStrings(evaluation.eventIds) ||
      !evaluation.eventIds.length || typeof evaluation.firstIntroduction !== 'boolean') fail('当日记忆基线损坏');
  for (const id of evaluation.eventIds) {
    const separator=id.lastIndexOf(':');
    if (id !== eventId(id.slice(0,separator),Number(id.slice(separator+1)))) fail('当日事件标识损坏');
  }
  assertDay(evaluation.dayKey);
  if (evaluation.firstIntroduction !== (evaluation.base === null)) fail('首次引入标记不一致');
  if (evaluation.firstIntroduction && (m.origin !== 'practice' || learningDay(m.introducedAt,timeZone) !== evaluation.dayKey)) fail('首次引入日期损坏');
  if (evaluation.base !== null) assertSchedule(evaluation.base,m.origin === 'legacy');
  if (m.lastReviewedAt === null || learningDay(m.lastReviewedAt,timeZone) !== evaluation.dayKey || lastAt !== m.lastReviewedAt) fail('当日评价时间损坏');
  const expected=scheduleFromBaseline(evaluation.base,evaluation.worstGrade,evaluation.dayKey);
  for (const key of ['status','repetition','intervalDays','nextReviewAt','lapseCount']) {
    if (m[key] !== expected[key]) fail('记忆日程与当日基线不一致');
  }
  for (const e of m.learningHistory.filter(e=>e.dayKey === evaluation.dayKey)) {
    if (!evaluation.eventIds.includes(e.eventId) || GRADES.indexOf(e.grade) < GRADES.indexOf(evaluation.worstGrade)) fail('当日事件与最差评价不一致');
  }
}

function assertPlan(plan, day, timeZone) {
  assertDay(day);
  if (!object(plan) || !text(plan.planId) || plan.dayKey !== day || plan.timeZone !== timeZone ||
      ![1,ALGORITHM_VERSION].includes(plan.algorithmVersion) || !text(plan.datasetRevision) ||
      !Number.isInteger(plan.goalSnapshot) || plan.goalSnapshot < 1 || plan.goalSnapshot > 2000 ||
      !['ready','active','paused','completed','archived'].includes(plan.status)) fail('每日计划损坏');
  assertTimestamp(plan.generatedAt); assertTimestamp(plan.updatedAt);
  if (plan.updatedAt < plan.generatedAt || learningDay(plan.generatedAt,timeZone) !== day) fail('计划时间损坏');
  const source=plan.newWordSource;
  if (!object(source) || !uniqueStrings(source.chapterIds) || source.chapterIds.some(id=>!/^[1-9]\d*$/.test(id)) ||
      !['ordered','random'].includes(source.mode) || !Array.isArray(plan.items) || !Array.isArray(plan.extraItems)) fail('计划来源损坏');
  const ids=new Set();
  for (const [items,extra] of [[plan.items,false],[plan.extraItems,true]]) for (const item of items) {
    if (!object(item) || !text(item.wordId) || ids.has(item.wordId) ||
        !(extra ? ['review'] : ['review','new']).includes(item.kind) ||
        !['pending','completed','unavailable'].includes(item.state)) fail('计划词条重复或损坏');
    ids.add(item.wordId);
  }
}

export function validateV2(data) {
  if (!object(data) || data.version !== STATE_VERSION) fail('存储版本不受支持，禁止降级覆盖');
  assertJSON(data);
  validateLegacy(data);
  if (!uint(data.revision) || !object(data.srs) || ![1,ALGORITHM_VERSION].includes(data.srs.algorithmVersion)) fail('复习版本或修订号无效');
  const srs=data.srs;
  if (srs.algorithmVersion === ALGORITHM_VERSION && !sameFields(srs.fsrsConfig,FSRS_CONFIG)) fail('FSRS 配置版本无效');
  assertTimeZone(srs.timeZone); assertTimestamp(srs.activatedAt);
  if (!object(srs.memories) || !object(srs.dailyPlans) || !uniqueStrings(srs.legacyLearnedIds)) fail('复习记录损坏');
  for (const [id,memory] of Object.entries(srs.memories)) {
    assertMemory(memory,id,srs.timeZone);
    if (memory.lastReviewedAt !== null && memory.lastReviewedAt < srs.activatedAt) fail('记忆事件早于复习系统启用时间');
  }
  for (const id of srs.legacyLearnedIds) if (!Object.hasOwn(srs.memories,id) || srs.memories[id].origin !== 'legacy') fail('旧学习索引损坏');
  for (const [day,plan] of Object.entries(srs.dailyPlans)) assertPlan(plan,day,srs.timeZone);
  if(srs.planSettings!==undefined) {
    const settings=srs.planSettings;
    if(!object(settings)||!uniqueStrings(settings.chapterIds)||settings.chapterIds.some(id=>!/^[1-9]\d*$/.test(id)) || !['ordered','random'].includes(settings.mode)) fail('每日计划设置损坏');
  }
  if(srs.planArchive!==undefined) {
    if(!object(srs.planArchive))fail('每日计划归档损坏');
    for(const [day,summary] of Object.entries(srs.planArchive)) {
      assertDay(day);
      if(!object(summary)||!text(summary.planId)||!Number.isInteger(summary.goalSnapshot)||summary.goalSnapshot<1||summary.goalSnapshot>2000)fail('每日计划归档损坏');
      for(const key of ['review','new','completedReview','completedNew','completed','total','unavailable','extra','completedExtra','shortage'])if(!uint(summary[key]))fail('每日计划归档统计损坏');
      if(summary.completedReview>summary.review||summary.completedNew>summary.new||summary.completed!==summary.completedReview+summary.completedNew||summary.total!==summary.review+summary.new||summary.completedExtra>summary.extra)fail('每日计划归档计数不一致');
      assertTimestamp(summary.archivedAt);
    }
  }
  if (data.session !== null) {
    const session=data.session;
    if (!text(session.sessionId)) fail('练习缺少稳定标识');
    if (session.planDayKey !== undefined) assertDay(session.planDayKey);
    if (session.planId !== undefined && !text(session.planId)) fail('练习计划标识损坏');
    if (session.source === 'daily-plan' && (!session.planId || !session.planDayKey)) fail('计划练习缺少来源');
    if(session.source==='daily-plan') {
      const plan=srs.dailyPlans[session.planDayKey];
      if(!plan || plan.planId!==session.planId)fail('会话与计划不一致');
      const ids=new Set([...plan.items,...plan.extraItems].map(i=>i.wordId));
      if(session.questions.some(q=>!ids.has(q.wordId)))fail('会话题目不属于原计划');
    }
    session.answers.forEach((answer,index)=>{
      if (answer.eventId !== undefined && answer.eventId !== eventId(session.sessionId,index)) fail('答案事件标识损坏');
    });
  }
  const result=structuredClone(data);
  for (const key of ['mistakes','notes','daily','stats']) result[key]=dict(result[key]);
  result.srs.memories=dict(result.srs.memories); result.srs.dailyPlans=dict(result.srs.dailyPlans);
  if(result.srs.planArchive)result.srs.planArchive=dict(result.srs.planArchive);
  return result;
}

export function createV2State({ now, timeZone = deviceTimeZone() } = {}) {
  assertTimestamp(now); assertTimeZone(timeZone);
  return validateV2({ ...initialState(), version: STATE_VERSION, revision: 0,
    srs: { algorithmVersion: ALGORITHM_VERSION, fsrsConfig: {...FSRS_CONFIG}, timeZone, activatedAt: now,
      memories: Object.create(null), legacyLearnedIds: [], dailyPlans: Object.create(null) } });
}

export function migrateV1(data, { now, timeZone = deviceTimeZone(), sessionIdFactory = newSessionId } = {}) {
  if (!object(data) || data.version !== 1) fail('迁移仅支持 v1 数据');
  assertJSON(data); validateLegacy(data);
  const result=createV2State({now,timeZone});
  Object.assign(result,structuredClone(data),{version:STATE_VERSION,revision:0,srs:result.srs});
  if (result.session !== null && !result.session.sessionId) result.session.sessionId=sessionIdFactory();
  const learned=new Set(Object.values(result.daily).flat());
  for (const [id,stats] of Object.entries(result.stats)) if (stats.correct > 0) learned.add(id);
  result.srs.legacyLearnedIds=[...learned].sort();
  for (const wordId of result.srs.legacyLearnedIds) result.srs.memories[wordId]={
    wordId,status:'learning',repetition:0,intervalDays:0,lastReviewedAt:null,
    nextReviewAt:learningDay(now,timeZone),lapseCount:0,introducedAt:null,origin:'legacy',
    algorithmVersion:1,dayEvaluation:null,learningHistory:[],historySummary:emptyHistorySummary()
  };
  return validateV2(result);
}

export function readV2(raw) {
  return upgradeFSRS(JSON.parse(raw));
}

// Pure and idempotent. No schedules, history, counts or plans are regenerated.
// Durable migration is separately guarded by a verified raw-data backup.
export function upgradeFSRS(data) {
  const result=validateV2(data);
  if (result.srs.algorithmVersion === 1) {
    result.srs.algorithmVersion=ALGORITHM_VERSION;
    result.srs.fsrsConfig={...FSRS_CONFIG};
  }
  return validateV2(result);
}

function assertFSRSMemory(m,wordId,timeZone) {
  if (!text(wordId) || m.wordId !== wordId || !['practice','legacy'].includes(m.origin) ||
      !sameFields(m.fsrsConfig,FSRS_CONFIG)) fail('FSRS 记忆标识或配置损坏');
  const card=restoreCard(m.fsrs), expected=memorySchedule(m.fsrs,timeZone);
  if (!card.last_review || m.lastReviewedAt !== card.last_review.getTime()) fail('FSRS 最近复习时间损坏');
  nullableTime(m.introducedAt);
  if (m.origin==='practice' && m.introducedAt===null || m.introducedAt!==null && m.introducedAt>m.lastReviewedAt) fail('FSRS 引入时间损坏');
  for (const key of Object.keys(expected)) if(m[key]!==expected[key])fail('FSRS 日程与卡片不一致');
  const summary=m.historySummary;
  if (!object(summary) || !uint(summary.count) || !object(summary.grades) ||
      !GRADES.every(g=>uint(summary.grades[g])) || GRADES.reduce((n,g)=>n+summary.grades[g],0)!==summary.count) fail('历史摘要损坏');
  nullableTime(summary.firstAt); nullableTime(summary.lastAt);
  if (summary.count===0 ? summary.firstAt!==null || summary.lastAt!==null :
      summary.firstAt===null || summary.lastAt===null || summary.firstAt>summary.lastAt) fail('历史摘要时间损坏');
  if (!Array.isArray(m.learningHistory) || !m.learningHistory.length) fail('FSRS 学习日志缺失');
  const ids=new Set(); let lastAt=summary.lastAt ?? -1, replay=null, seenFSRS=false;
  for (const e of m.learningHistory) {
    assertHistoryEvent(e,wordId,timeZone);
    if(ids.has(e.eventId) || e.at<lastAt)fail('学习历史重复或乱序');
    ids.add(e.eventId);lastAt=e.at;
    if(e.algorithmVersion===1) { if(seenFSRS)fail('旧历史不能出现在 FSRS 之后'); continue; }
    seenFSRS=true;
    if(e.schedulingEffect!=='fsrs')fail('FSRS 调度来源损坏');
    assertFSRSLog(e.fsrsLog,e.grade,e.at);
    const result=scheduleFSRS(replay,e.grade,e.at);
    if(!sameFields(result.log,e.fsrsLog))fail('FSRS 日志与实际调度不一致');
    replay=result.card;
  }
  if(lastAt!==m.lastReviewedAt || !sameFields(replay,m.fsrs))fail('FSRS 卡片与日志不一致');
  const evaluation=m.dayEvaluation, day=learningDay(m.lastReviewedAt,timeZone);
  const today=m.learningHistory.filter(e=>e.algorithmVersion===ALGORITHM_VERSION && e.dayKey===day);
  if (!object(evaluation) || evaluation.dayKey!==day || !uniqueStrings(evaluation.eventIds) ||
      !GRADES.includes(evaluation.worstGrade) || typeof evaluation.firstIntroduction!=='boolean' || evaluation.base!==null ||
      evaluation.firstIntroduction!==(card.reps===1 && !m.legacySchedule && m.origin==='practice') ||
      today.some(e=>!evaluation.eventIds.includes(e.eventId)) ||
      evaluation.eventIds.length!==today.length ||
      evaluation.worstGrade!==GRADES[today.reduce((worst,e)=>Math.min(worst,GRADES.indexOf(e.grade)),2)]) fail('FSRS 当日事件索引损坏');
}
