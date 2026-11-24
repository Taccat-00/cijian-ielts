// Official self-contained ESM distribution; no CDN or runtime network access.
import { createEmptyCard, fsrs, generatorParameters, Rating, State, FSRSVersion } from '../vendor/ts-fsrs-5.2.3.js';
import { assertTimestamp, learningDay } from './calendar.js';

export const FSRS_CONFIG = Object.freeze({ library: 'ts-fsrs', version: '5.2.3', model: 'FSRS-6',
  implementation: FSRSVersion, request_retention: 0.90, enable_short_term: false });
// Day-based sessions have no minute queue. Use the library's supported long-term
// scheduler, rather than rewriting its due dates after scheduling.
const scheduler = fsrs(generatorParameters({ request_retention: FSRS_CONFIG.request_retention,
  enable_short_term: FSRS_CONFIG.enable_short_term }));
const ratings = Object.freeze({ again: Rating.Again, hard: Rating.Hard, good: Rating.Good });
const iso = value => {
  if (typeof value !== 'string' || new Date(value).toISOString() !== value) throw new Error('FSRS 日期无效');
  return new Date(value);
};
export const serializeFSRS = value => JSON.parse(JSON.stringify(value));

export function restoreCard(value) {
  if (!value || typeof value !== 'object') throw new Error('FSRS 卡片缺失');
  const card = { ...value, due: iso(value.due) };
  if (value.last_review !== undefined) card.last_review = iso(value.last_review);
  for (const key of ['stability','difficulty','elapsed_days','scheduled_days','learning_steps','reps','lapses']) {
    if (!Number.isFinite(card[key]) || card[key] < 0) throw new Error('FSRS 数值无效');
  }
  for (const key of ['scheduled_days','learning_steps','reps','lapses']) {
    if (!Number.isSafeInteger(card[key])) throw new Error('FSRS 计数无效');
  }
  if (![State.New,State.Learning,State.Review,State.Relearning].includes(card.state) ||
      card.difficulty > 10 || card.lapses > card.reps ||
      (card.reps > 0 && (!card.last_review || card.stability <= 0 || card.difficulty < 1)) ||
      (card.last_review && card.due < card.last_review)) throw new Error('FSRS 状态无效');
  return card;
}

export function scheduleFSRS(previous, grade, at) {
  assertTimestamp(at);
  if (!Object.hasOwn(ratings, grade)) throw new Error('FSRS 评分无效');
  const now = new Date(at), card = previous ? restoreCard(previous) : createEmptyCard(now);
  if (card.last_review && now < card.last_review) throw new Error('学习时钟回退，请校时后重试');
  return serializeFSRS(scheduler.next(card, now, ratings[grade]));
}

// Compatibility fields serve the existing date-only UI and daily-plan selector.
// The exact UTC due instant is always preserved in fsrs.due.
export function memorySchedule(card, timeZone) {
  const restored = restoreCard(card);
  return { status: restored.state === State.Relearning ? 'relearning' : restored.state === State.Learning ? 'learning' : 'review',
    repetition: restored.reps, intervalDays: restored.scheduled_days,
    nextReviewAt: learningDay(restored.due.getTime(), timeZone), lapseCount: restored.lapses };
}

export function assertFSRSLog(log, grade, at) {
  if (!log || log.rating !== ratings[grade] || iso(log.review).getTime() !== at ||
      ![0,1,2,3].includes(log.state)) throw new Error('FSRS 日志损坏');
  iso(log.due);
  for (const key of ['stability','difficulty','elapsed_days','last_elapsed_days','scheduled_days','learning_steps']) {
    if (!Number.isFinite(log[key]) || log[key] < 0) throw new Error('FSRS 日志数值损坏');
  }
}
