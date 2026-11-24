import { learningDay } from './review/calendar.js';

export const STORAGE_KEY = 'cijian.ielts.v1';
export const TYPES = ['zh-en', 'en-zh', 'listening'];
export const TYPE_LABELS = { 'zh-en': '看中文写英文', 'en-zh': '看英文想中文', listening: '听音拼写', mixed: '随机混合' };
export const RATING_LABELS = { wrong: '错误', fuzzy: '模糊', correct: '正确' };

export function localDate(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
export function studyDate(state, date = new Date()) {
  return state.version === 2 ? learningDay(date.getTime(), state.srs.timeZone) : localDate(date);
}
export function effectiveGoal(state, date = new Date()) {
  return state.srs?.dailyPlans[studyDate(state,date)]?.goalSnapshot ?? state.goal;
}
export function normalizeEnglish(value) {
  return String(value).normalize('NFKC').toLowerCase().trim().replace(/[‘’]/g, "'").replace(/[‐‑–—]/g, '-').replace(/\s+/g, ' ');
}
export function normalizeChinese(value) {
  return String(value).normalize('NFKC').replace(/\([^)]*\)|\[[^\]]*\]/g, '').replace(/[\s。，、；;,.!?！？：:“”"'·]/g, '').trim();
}
export function chineseAnswers(meanings) {
  return [...new Set(meanings.flatMap(s => s.replace(/\([^)]*\)|（[^）]*）|\[[^\]]*\]/g, '').replace(/\/[a-zɑ-ʯˈˌː.\s]+\//gi, '').split(/[；;／/，,]/)).map(normalizeChinese).filter(Boolean))];
}
export function judge(word, type, answer) {
  if (!String(answer).trim()) return false;
  if (type === 'en-zh') {
    const accepted = chineseAnswers([...word.meanings, ...(word.acceptedChinese || [])]);
    return String(answer).split(/[；;／/，,、]/).map(normalizeChinese).some(s => s && accepted.includes(s));
  }
  return [word.word, ...(word.variants || [])].map(normalizeEnglish).includes(normalizeEnglish(answer));
}
export function shuffle(items, random = Math.random) {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}
export function initialState() {
  return { version: 1, goal: 100, saved: [], mistakes: Object.create(null), notes: Object.create(null), daily: Object.create(null), stats: Object.create(null), session: null };
}
export function validSession(s, wordIds) {
  if (s === null) return true;
  if (!s || !['active', 'paused', 'finished'].includes(s.status) || !Array.isArray(s.questions) || !s.questions.length || !Array.isArray(s.answers)) return false;
  if (![...TYPES, 'mixed'].includes(s.mode) || !['chapter','saved','mistakes','daily-plan'].includes(s.source) || typeof s.label !== 'string' || typeof s.draft !== 'string' || !Number.isFinite(s.startedAt)) return false;
  if (s.chapterIds !== undefined && (!Array.isArray(s.chapterIds) || s.chapterIds.some(id => typeof id !== 'string' || !/^[1-9]\d*$/.test(id)))) return false;
  if (!Number.isInteger(s.index) || s.index < 0 || s.index > s.questions.length || s.answers.length > s.questions.length) return false;
  if (s.answers.length !== s.index && s.answers.length !== s.index + 1) return false;
  if (s.status !== 'finished' && s.index >= s.questions.length) return false;
  if (s.questions.some(q => !q || !wordIds.has(q.wordId) || !TYPES.includes(q.type))) return false;
  if (new Set(s.questions.map(q => q.wordId)).size !== s.questions.length) return false;
  if (s.answers.some((a, i) => !a || a.wordId !== s.questions[i].wordId || typeof a.correct !== 'boolean' || typeof a.input !== 'string' || typeof a.skipped !== 'boolean' || !Number.isFinite(a.at) || (a.skipped && a.correct))) return false;
  if (s.revealed !== undefined && typeof s.revealed !== 'boolean') return false;
  if (s.answers.some((a, i) => a.rating !== undefined && (!Object.hasOwn(RATING_LABELS, a.rating) || s.questions[i].type !== 'en-zh' || a.correct !== (a.rating === 'correct')))) return false;
  if (s.status === 'active' && s.timed && !Number.isFinite(s.deadline)) return false;
  return (s.deadline === null || Number.isFinite(s.deadline)) && Number.isFinite(s.remainingMs) && s.remainingMs >= 0 && typeof s.timed === 'boolean';
}
export function readState(raw, wordIds) {
  if (!raw) return initialState();
  const data = JSON.parse(raw);
  if (!data || data.version !== 1 || !Number.isInteger(data.goal) || data.goal < 1 || data.goal > 2000 || !Array.isArray(data.saved)) throw new Error('存储格式不受支持');
  for (const key of ['mistakes', 'notes', 'daily', 'stats']) {
    if (!data[key] || typeof data[key] !== 'object' || Array.isArray(data[key])) throw new Error('存储记录损坏');
  }
  if (Object.values(data.notes).some(s => typeof s !== 'string') || Object.entries(data.daily).some(([day, a]) => !/^\d{4}-\d{2}-\d{2}$/.test(day) || !Array.isArray(a) || a.some(id => typeof id !== 'string'))) throw new Error('存储记录损坏');
  if (Object.values(data.mistakes).some(a => !a || !Number.isInteger(a.count) || a.count < 1 || !Number.isFinite(a.lastAt))) throw new Error('错题记录损坏');
  if (Object.values(data.stats).some(a => !a || !Number.isInteger(a.attempts) || !Number.isInteger(a.correct) || a.correct < 0 || a.correct > a.attempts)) throw new Error('练习记录损坏');
  if (!validSession(data.session, wordIds)) data.session = null;
  // A temporary fallback to the demo dataset must not discard the user's collection.
  data.saved = [...new Set(data.saved.filter(id => typeof id === 'string'))];
  for (const key of ['mistakes','notes','daily','stats']) data[key] = Object.assign(Object.create(null), data[key]);
  return data;
}
export function startSession(words, options, now = Date.now(), random = Math.random) {
  if (![...TYPES, 'mixed'].includes(options.mode)) throw new Error('请选择有效的练习方式');
  const unique = [...new Map(words.map(word => [word.id, word])).values()];
  const count = options.count === 'all' ? unique.length : Math.min(Number(options.count), unique.length);
  if (!unique.length || !Number.isInteger(count) || count < 1) throw new Error('请至少选择一个有词汇的章节');
  const types = shuffle(TYPES, random);
  const questions = shuffle(unique, random).slice(0, count).map((word, i) => ({ wordId: word.id, type: options.mode === 'mixed' ? types[i % 3] : options.mode }));
  const duration = Math.max(1, Math.min(180, Number(options.minutes) || 10)) * 60000;
  return { questions, index: 0, answers: [], status: 'active', source: options.source, chapterIds: options.chapterIds || [], label: options.label, mode: options.mode, timed: !!options.timed, remainingMs: duration, deadline: options.timed ? now + duration : null, startedAt: now, draft: '', revealed: false, reason: null };
}
export function remainingTime(session, now = Date.now()) {
  return session.status === 'active' && session.timed ? Math.max(0, session.deadline - now) : session.remainingMs;
}
export function finishSession(session, reason, now = Date.now()) {
  session.remainingMs = remainingTime(session, now);
  session.status = 'finished';
  session.deadline = null;
  session.reason = reason;
}
export function expireSession(session, now = Date.now()) {
  if (session?.status === 'active' && session.timed && remainingTime(session, now) === 0) {
    finishSession(session, session.answers.length === session.questions.length ? 'completed' : 'timeout', now);
    return true;
  }
  return false;
}
export function togglePause(session, now = Date.now()) {
  if (session.status === 'active') {
    if (expireSession(session, now)) return;
    session.remainingMs = remainingTime(session, now);
    session.status = 'paused';
    session.deadline = null;
  } else if (session.status === 'paused') {
    session.status = 'active';
    session.deadline = session.timed ? now + session.remainingMs : null;
  }
}
export function recordAnswer(state, word, input, skipped = false, now = Date.now()) {
  const s = state.session;
  if (!s || s.status !== 'active' || expireSession(s, now) || s.answers.length > s.index) return null;
  if (s.questions[s.index].type === 'en-zh' || s.questions[s.index].wordId !== word.id || (!skipped && !input.trim())) return null;
  const correct = !skipped && judge(word, s.questions[s.index].type, input);
  const answer = { wordId: word.id, input, correct, skipped, at: now };
  return recordOutcome(state, answer, now);
}
export function revealMeaning(session, wordId, now = Date.now()) {
  if (!session || session.status !== 'active' || expireSession(session, now) || session.answers.length > session.index) return false;
  const question = session.questions[session.index];
  if (question.type !== 'en-zh' || question.wordId !== wordId) return false;
  session.revealed = true;
  return true;
}
export function recordSelfAssessment(state, wordId, rating, now = Date.now()) {
  const s = state.session;
  if (!s || s.status !== 'active' || expireSession(s, now) || s.answers.length > s.index || !s.revealed) return null;
  const question = s.questions[s.index];
  if (question.type !== 'en-zh' || question.wordId !== wordId || !Object.hasOwn(RATING_LABELS, rating)) return null;
  return recordOutcome(state, { wordId, input: '', correct: rating === 'correct', rating, skipped: false, at: now }, now);
}
export function answerCounts(answers) {
  return answers.reduce((counts, answer) => {
    counts[answer.rating === 'fuzzy' ? 'fuzzy' : answer.correct ? 'correct' : 'wrong']++;
    return counts;
  }, { correct: 0, fuzzy: 0, wrong: 0 });
}
function recordOutcome(state, answer, now) {
  const s = state.session;
  const { wordId, correct, skipped } = answer;
  s.answers.push(answer);
  s.draft = '';
  if (!correct) {
    const old = state.mistakes[wordId];
    state.mistakes[wordId] = { count: (old?.count || 0) + 1, lastAt: now, lastRating: answer.rating || 'wrong' };
  }
  const stats = state.stats[wordId] || { attempts: 0, correct: 0 };
  state.stats[wordId] = { attempts: stats.attempts + 1, correct: stats.correct + Number(correct) };
  if (!skipped) {
    const day = studyDate(state,new Date(now));
    state.daily[day] = [...new Set([...(state.daily[day] || []), wordId])];
  }
  return answer;
}
export function nextQuestion(session, now = Date.now()) {
  if (session.status !== 'active' || expireSession(session, now) || session.answers.length <= session.index) return;
  session.index++;
  session.revealed = false;
  if (session.index >= session.questions.length) finishSession(session, 'completed', now);
}
export function dailyCount(state, date = new Date()) {
  return new Set(state.daily[studyDate(state,date)] || []).size;
}
export function dailyProgress(state, date = new Date()) {
  const count = dailyCount(state, date);
  const goal = effectiveGoal(state,date);
  return { count, percent: Math.min(100, Math.floor(count / goal * 100)), complete: count >= goal };
}

export function parseVocabulary(raw) {
  const lines = raw.replace(/^\uFEFF/, '').split(/\r?\n/).map(s => s.trim());
  const chapters = [], words = new Map();
  let chapter;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i + 1] === '+++') {
      chapter = { id: String(chapters.length + 1), name: lines[i], subtitle: '' };
      chapters.push(chapter); i++; continue;
    }
    if (!chapter || !lines[i].includes('|')) continue;
    const [head, pos, meaning, example = '', ...notes] = lines[i].split('|');
    if (!head || !meaning) throw new Error(`第 ${i + 1} 行缺少单词或释义`);
    const variants = head.split('/').map(s => s.trim()).filter(Boolean);
    const id = normalizeEnglish(variants[0]);
    const current = words.get(id);
    if (current) {
      current.chapters = [...new Set([...current.chapters, chapter.id])];
      current.meanings = [...new Set([...current.meanings, meaning])];
      current.variants = [...new Set([...current.variants, ...variants])];
      current.pos = [...new Set([...current.pos.split('/'), ...pos.split('/')])].join('/');
    } else {
      words.set(id, { id, word: variants[0], variants, pos, meanings: [meaning], chapters: [chapter.id], phonetic: '', example, translation: '', memory: '', usage: notes.join('；'), source: 'my-ielts' });
    }
  }
  if (chapters.length !== 22 || words.size < 3000) throw new Error(`词表结构异常：${chapters.length} 章 / ${words.size} 词`);
  return { version: 1, name: '雅思词汇真经', kind: 'local', source: 'https://github.com/hefengxian/my-ielts', chapters, words: [...words.values()] };
}
