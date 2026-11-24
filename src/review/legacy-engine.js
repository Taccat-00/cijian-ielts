// Frozen v1 schedule rules, used only to validate legacy snapshots. Never called for new reviews.
import { addDays, isDue } from './calendar.js';
export const INTERVALS = Object.freeze([1, 3, 7, 14, 30]);
function transition(base, grade, today) {
  if (!base) return { status: 'learning', repetition: grade === 'good' ? 1 : 0,
    intervalDays: 1, nextReviewAt: addDays(today, 1), lapseCount: 0 };
  if (grade === 'again') return { status: 'relearning', repetition: 0, intervalDays: 1,
    nextReviewAt: addDays(today, 1), lapseCount: base.lapseCount + 1 };
  if (grade === 'hard') {
    const intervalDays = Math.min(3, Math.max(1, base.intervalDays));
    const next = addDays(today, intervalDays);
    return { status: base.status === 'relearning' ? 'relearning' : 'learning', repetition: 0,
      intervalDays, lapseCount: base.lapseCount,
      nextReviewAt: isDue(base.nextReviewAt, today) ? next : [base.nextReviewAt, next].sort()[0] };
  }
  if (!isDue(base.nextReviewAt, today)) return { ...base };
  const repetition = Math.min(5, base.repetition + 1), intervalDays = INTERVALS[repetition - 1];
  return { status: repetition >= 2 ? 'review' : 'learning', repetition, intervalDays,
    nextReviewAt: addDays(today, intervalDays), lapseCount: base.lapseCount };
}

// Shared by the schema validator to verify persisted scheduling invariants.
export { transition as scheduleFromBaseline };

