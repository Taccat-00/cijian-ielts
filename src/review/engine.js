import { learningDay, assertTimestamp } from './calendar.js';
import { scheduleFSRS, memorySchedule, FSRS_CONFIG } from './fsrs.js';

export const ALGORITHM_VERSION = 2;
export const GRADES = Object.freeze(['again', 'hard', 'good']);
export const EFFECTS = Object.freeze(['advance', 'downgrade', 'observe', 'early', 'fsrs']);
export const emptyHistorySummary = () => ({ count: 0, grades: { again: 0, hard: 0, good: 0 }, firstAt: null, lastAt: null });

export function eventId(sessionId, questionIndex) {
  if (typeof sessionId !== 'string' || !sessionId.trim() || !Number.isSafeInteger(questionIndex) || questionIndex < 0) throw new Error('练习事件标识无效');
  // Delimiter makes (session1, 23) distinct from (session12, 3).
  return `${sessionId}:${questionIndex}`;
}

export function mapPracticeResult(question, answer) {
  if (!answer || answer.skipped === true) return null;
  if (!question || !['zh-en', 'en-zh', 'listening'].includes(question.type)) return null;
  if (answer.wordId !== question.wordId || typeof answer.correct !== 'boolean' || answer.skipped !== false) throw new Error('练习结果无效');
  if (question.type === 'en-zh') {
    const ratings = { correct: 'good', fuzzy: 'hard', wrong: 'again' };
    if (!Object.hasOwn(ratings, answer.rating) || answer.correct !== (answer.rating === 'correct')) throw new Error('回忆评价无效');
    return ratings[answer.rating];
  }
  if (answer.rating !== undefined) throw new Error('拼写题不支持自评');
  return answer.correct ? 'good' : 'again';
}

export function practiceEvent(session, questionIndex) {
  const question = session.questions[questionIndex], answer = session.answers[questionIndex];
  const grade = mapPracticeResult(question, answer);
  if (grade === null) return null;
  return { eventId: eventId(session.sessionId, questionIndex), sessionId: session.sessionId,
    questionIndex, wordId: question.wordId, type: question.type, source: session.source, at: answer.at, grade };
}

// Pure, chronological observation API. Arbitrary historical replay is unsupported;
// the repository additionally gates submissions against the current session slot.
export function evaluateMemory(previous, event, timeZone) {
  if (!event || event.eventId !== eventId(event.sessionId, event.questionIndex) ||
      typeof event.wordId !== 'string' || !event.wordId.trim() || !GRADES.includes(event.grade) ||
      !['zh-en', 'en-zh', 'listening'].includes(event.type) ||
      !['chapter', 'saved', 'mistakes', 'daily-plan'].includes(event.source)) throw new Error('记忆事件无效');
  assertTimestamp(event.at);
  const dayKey = learningDay(event.at, timeZone);
  if (previous && previous.wordId !== event.wordId) throw new Error('单词记忆标识不一致');
  if (previous?.dayEvaluation?.eventIds.includes(event.eventId) || previous?.learningHistory.some(e => e.eventId === event.eventId)) {
    return { accepted: false, memory: previous };
  }
  if (previous?.lastReviewedAt !== null && previous?.lastReviewedAt > event.at) throw new Error('学习时钟回退，请校时后重试');
  const memory = previous ? structuredClone(previous) : {
    wordId: event.wordId, introducedAt: event.at, origin: 'practice', algorithmVersion: ALGORITHM_VERSION,
    learningHistory: [], historySummary: emptyHistorySummary()
  };
  const sameDay = previous?.algorithmVersion === ALGORITHM_VERSION && memory.dayEvaluation?.dayKey === dayKey;
  const oldWorst = sameDay ? memory.dayEvaluation.worstGrade : null;
  const worstGrade = oldWorst && GRADES.indexOf(oldWorst) < GRADES.indexOf(event.grade) ? oldWorst : event.grade;
  if (previous && previous.algorithmVersion === 1) {
    // Historical events are incomplete (20 rows + summary), so don't replay or
    // interpret old stages as difficulty/stability. Retain their actual values.
    memory.legacySchedule = Object.fromEntries(['status','repetition','intervalDays','nextReviewAt','lapseCount','dayEvaluation'].map(k=>[k,structuredClone(previous[k])]));
  }
  const result = scheduleFSRS(previous?.fsrs, event.grade, event.at);
  memory.fsrs = result.card;
  memory.fsrsConfig = { ...FSRS_CONFIG };
  memory.algorithmVersion = ALGORITHM_VERSION;
  Object.assign(memory, memorySchedule(result.card, timeZone));
  memory.lastReviewedAt = event.at;
  // Summary is retained for compatibility; it no longer determines scheduling.
  memory.dayEvaluation = { dayKey, base: null, firstIntroduction: !previous, worstGrade,
    eventIds: [...(sameDay ? memory.dayEvaluation.eventIds : []), event.eventId] };
  memory.learningHistory.push({ ...event, dayKey, schedulingEffect: 'fsrs', algorithmVersion: ALGORITHM_VERSION, fsrsLog: result.log });
  // Preserve every FSRS review log. Quota failure is handled atomically by the
  // repository; never prune real reviews into synthetic historical ratings.
  return { accepted: true, memory };
}
