// Learning dates are calendar dates in a persisted zone, never device midnights.
const formatters = new Map();
function formatter(timeZone) {
  if (typeof timeZone !== 'string' || !/^[A-Za-z][A-Za-z0-9_+\-]*(?:\/[A-Za-z0-9_+\-]+)*$/.test(timeZone)) throw new Error('学习时区无效');
  if (!formatters.has(timeZone)) {
    const value = new Intl.DateTimeFormat('en-US', {
      timeZone, calendar: 'gregory', numberingSystem: 'latn', year: 'numeric', month: '2-digit', day: '2-digit'
    });
    // A small cache avoids constructing Intl formatters for every history row.
    if (formatters.size >= 16) formatters.delete(formatters.keys().next().value);
    formatters.set(timeZone,value);
  }
  return formatters.get(timeZone);
}

export function assertTimeZone(timeZone) {
  formatter(timeZone);
  return timeZone;
}

export function deviceTimeZone() {
  return assertTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone);
}

export function assertTimestamp(at) {
  if (!Number.isSafeInteger(at) || at < 0 || !Number.isFinite(new Date(at).getTime())) throw new Error('学习时间无效');
  return at;
}

export function assertDay(day) {
  if (typeof day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(day) || day < '0001-01-01') throw new Error('学习日期无效');
  const date = new Date(`${day}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== day) throw new Error('学习日期无效');
  return day;
}

export function learningDay(at, timeZone) {
  assertTimestamp(at);
  const parts = formatter(timeZone).formatToParts(at);
  const part = type => parts.find(p => p.type === type).value;
  return assertDay(`${part('year').padStart(4, '0')}-${part('month')}-${part('day')}`);
}

export function addDays(day, count) {
  assertDay(day);
  if (!Number.isSafeInteger(count)) throw new Error('日期间隔无效');
  const date = new Date(`${day}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + count);
  if (!Number.isFinite(date.getTime())) throw new Error('日期超出范围');
  return assertDay(date.toISOString().slice(0, 10));
}

export function isDue(nextReviewAt, today) {
  return assertDay(nextReviewAt) <= assertDay(today);
}
