import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { initialState, judge, startSession, recordAnswer, revealMeaning, recordSelfAssessment, answerCounts, nextQuestion, togglePause, remainingTime, expireSession, dailyCount, dailyProgress, localDate, readState, parseVocabulary } from '../src/core.js';

const words = [
  { id:'colour', word:'colour', variants:['colour','color'], meanings:['颜色；色彩'], chapters:['1','2'] },
  { id:'coast', word:'coast', variants:['coast'], meanings:['海岸；海滨'], chapters:['1'] },
  { id:'oxygen', word:'oxygen', variants:['oxygen'], meanings:['氧气'], chapters:['2'] }
];
const options = { count:'all', mode:'zh-en', source:'chapter', label:'测试', timed:false, minutes:1 };
const now = new Date(2026,9,14,10,0).getTime();
test('每日目标不足一词时不提前达成，完成后进度不超过 100%', () => {
  const state = initialState(), date = new Date(now), day = localDate(date);
  state.goal = 200;
  assert.deepEqual(dailyProgress(state, date), { count: 0, percent: 0, complete: false });
  state.daily[day] = Array.from({length:199}, (_, i) => `word-${i}`);
  assert.deepEqual(dailyProgress(state, date), { count: 199, percent: 99, complete: false });
  state.daily[day].push('word-0');
  assert.equal(dailyProgress(state, date).count, 199);
  state.daily[day].push('word-199');
  assert.deepEqual(dailyProgress(state, date), { count: 200, percent: 100, complete: true });
  state.goal = 100;
  assert.deepEqual(dailyProgress(state, date), { count: 200, percent: 100, complete: true });
  assert.deepEqual(dailyProgress(state, new Date(2026,9,15)), { count: 0, percent: 0, complete: false });
});
function setup(overrides = {}, candidates = words) {
  const state = initialState();
  state.session = startSession(candidates, {...options,...overrides}, now, () => .99);
  return state;
}
test('英文允许大小写、首尾空格和已列出的英美拼写，但不接受近似拼写', () => {
  assert.equal(judge(words[0],'zh-en','  COLOR  '),true);
  assert.equal(judge(words[0],'listening','colur'),false);
  assert.equal(judge(words[0],'zh-en','col'),false);
  assert.equal(judge({word:'carbon dioxide', variants:[]},'zh-en','Carbon   Dioxide'),true);
});
test('中文接受任一个完整释义，不接受空白、标点或子字符串', () => {
  assert.equal(judge(words[0],'en-zh','色彩'),true);
  assert.equal(judge(words[0],'en-zh','颜色。'),true);
  assert.equal(judge(words[0],'en-zh','颜'),false);
  assert.equal(judge(words[0],'en-zh','；'),false);
  assert.equal(judge(words[0],'en-zh','  '),false);
  assert.equal(judge({meanings:['（海、湖等的）岸；海滨']},'en-zh','岸'),true);
});
test('多章混合按词条去重、每词只出现一次且覆盖三种题型', () => {
  const s = setup({mode:'mixed'}, [...words,words[0]]).session;
  assert.equal(s.questions.length,3);
  assert.equal(new Set(s.questions.map(q => q.wordId)).size,3);
  assert.equal(new Set(s.questions.map(q => q.type)).size,3);
});
test('题数不超过实际词数，空词池不可开始', () => {
  assert.equal(setup({count:20}).session.questions.length,3);
  assert.throws(() => setup({},[]));
});
test('首次答错收录错题并计入每日目标，连续提交不重复记账', () => {
  const state = setup();
  recordAnswer(state,words[0],'wrong',false,now);
  recordAnswer(state,words[0],'colour',false,now);
  assert.equal(state.session.answers.length,1);
  assert.equal(state.mistakes.colour.count,1);
  assert.equal(dailyCount(state,new Date(now)),1);
});
test('同一天跨轮重复练习只计一次，正确复习不自动删除错题', () => {
  const state = setup();
  recordAnswer(state,words[0],'wrong',false,now);
  state.session = startSession([words[0]],options,now);
  recordAnswer(state,words[0],'color',false,now);
  assert.equal(dailyCount(state,new Date(now)),1);
  assert.equal(state.mistakes.colour.count,1);
  assert.deepEqual(state.stats.colour,{attempts:2,correct:1});
});
test('重复错误累计次数，跳过进错题本但不增加每日完成', () => {
  const state = setup();
  recordAnswer(state,words[0],'',true,now);
  assert.equal(dailyCount(state,new Date(now)),0);
  state.session = startSession([words[0]],options,now);
  recordAnswer(state,words[0],'oops',false,now);
  assert.equal(state.mistakes.colour.count,2);
});
test('午夜按本地日期重新去重，旧日期记录保留', () => {
  const state = setup();
  const before = new Date(2026,9,14,23,59,59).getTime();
  const after = new Date(2026,9,15,0,0,1).getTime();
  recordAnswer(state,words[0],'colour',false,before);
  state.session = startSession([words[0]],options,after);
  recordAnswer(state,words[0],'colour',false,after);
  assert.equal(localDate(new Date(after)),'2026-10-15');
  assert.equal(dailyCount(state,new Date(before)),1);
  assert.equal(dailyCount(state,new Date(after)),1);
});
test('暂停冻结整轮剩余时间，恢复重新计算结束时刻', () => {
  const state = setup({timed:true});
  togglePause(state.session,now+10000);
  assert.equal(remainingTime(state.session,now+600000),50000);
  assert.equal(recordAnswer(state,words[0],'colour',false,now+10000),null);
  togglePause(state.session,now+600000);
  assert.equal(state.session.deadline,now+650000);
  assert.equal(remainingTime(state.session,now+610000),40000);
});
test('刷新后按绝对时刻结算超时，不把未作答的单词记错', () => {
  const original = setup({timed:true});
  recordAnswer(original,words[0],'colour',false,now+1000);
  nextQuestion(original.session,now+1001);
  const state = readState(JSON.stringify(original),new Set(words.map(w=>w.id)));
  assert.equal(expireSession(state.session,now+61000),true);
  assert.equal(state.session.reason,'timeout');
  assert.equal(state.session.answers.length,1);
  assert.equal(Object.keys(state.mistakes).length,0);
});
test('恰好到时的提交不计入成绩，计时关闭不自动结束', () => {
  const timed = setup({timed:true});
  assert.equal(recordAnswer(timed,words[0],'colour',false,now+60000),null);
  assert.equal(timed.session.status,'finished');
  const untimed = setup();
  assert.equal(expireSession(untimed.session,now+999999999),false);
});
test('最后一题提交后查看结果，保留完整答案；未答题不可前进', () => {
  const state = setup({},[words[0]]);
  nextQuestion(state.session,now);
  assert.equal(state.session.index,0);
  recordAnswer(state,words[0],'colour',false,now);
  nextQuestion(state.session,now);
  assert.equal(state.session.status,'finished');
  assert.equal(state.session.reason,'completed');
  assert.equal(state.session.answers.length,1);
});
test('笔记、生词、练习草稿和错题可序列化恢复', () => {
  const state = setup();
  state.notes.colour = '我的笔记 <script>不执行</script>';
  state.saved = ['colour']; state.session.draft = 'col';
  const restored = readState(JSON.stringify(state),new Set(words.map(w=>w.id)));
  assert.deepEqual(restored,state);
});
test('损坏存储报错，词库变化使旧轮次失效但保留笔记', () => {
  assert.throws(() => readState('{',new Set()));
  assert.throws(() => readState(JSON.stringify({...initialState(),notes:[]}),new Set()));
  const state = setup(); state.notes.colour = 'still here';
  const restored = readState(JSON.stringify(state),new Set(['coast']));
  assert.equal(restored.session,null);
  assert.equal(restored.notes.colour,'still here');
});
test('临时回退到示例词库时不删除其他词库的收藏', () => {
  const state = setup(); state.saved = ['colour','coast','colour'];
  const restored = readState(JSON.stringify(state),new Set(['coast']));
  assert.deepEqual(restored.saved,['colour','coast']);
  assert.equal(restored.session,null);
});
test('空记录、坏错题拒绝读取，坏题目仅使练习失效', () => {
  assert.throws(() => readState('null',new Set()));
  assert.throws(() => readState(JSON.stringify({...initialState(),mistakes:{colour:null}}),new Set()));
  const state = setup(); state.session.questions[0] = null;
  assert.equal(readState(JSON.stringify(state),new Set(words.map(w=>w.id))).session,null);
});
test('中文释义括号中的逗号与混入的音标不干扰判分', () => {
  const word = {meanings:['（海,湖等的）岸；/kəʊst/ 海滨']};
  assert.equal(judge(word,'en-zh','岸'),true);
  assert.equal(judge(word,'en-zh','海滨'),true);
  assert.equal(judge(word,'en-zh','湖等的'),false);
});
test('练习保留所选章节，拒绝无效题型', () => {
  const state = setup({chapterIds:['1','2']});
  assert.deepEqual(state.session.chapterIds,['1','2']);
  assert.throws(() => setup({mode:'unsupported'}));
});
test('回忆题必须先显示意思，显示和文字输入均不记为作答', () => {
  const state = setup({mode:'en-zh'});
  assert.equal(recordSelfAssessment(state,'colour','correct',now),null);
  assert.equal(recordAnswer(state,words[0],'颜色',false,now),null);
  assert.equal(revealMeaning(state.session,'coast',now),false);
  assert.equal(revealMeaning(state.session,'colour',now),true);
  assert.equal(state.session.answers.length,0);
  assert.equal(dailyCount(state,new Date(now)),0);
  assert.deepEqual(Object.keys(state.mistakes),[]);
});
test('三档自评分别记录，错误与模糊收录错题且均计入每日目标', () => {
  const state = setup({mode:'en-zh'});
  for (const [index,rating] of ['wrong','fuzzy','correct'].entries()) {
    revealMeaning(state.session,words[index].id,now);
    const answer = recordSelfAssessment(state,words[index].id,rating,now);
    assert.equal(answer.rating,rating);
    assert.equal(answer.correct,rating === 'correct');
    nextQuestion(state.session,now);
  }
  assert.deepEqual(answerCounts(state.session.answers),{wrong:1,fuzzy:1,correct:1});
  assert.equal(state.session.status,'finished');
  assert.equal(state.mistakes.colour.lastRating,'wrong');
  assert.equal(state.mistakes.coast.lastRating,'fuzzy');
  assert.equal(state.mistakes.oxygen,undefined);
  assert.equal(dailyCount(state,new Date(now)),3);
});
test('自评拒绝重复、无效与错位提交，下一题重新隐藏释义', () => {
  const state = setup({mode:'en-zh'});
  revealMeaning(state.session,'colour',now);
  assert.equal(recordSelfAssessment(state,'colour','unknown',now),null);
  assert.equal(recordSelfAssessment(state,'coast','wrong',now),null);
  recordSelfAssessment(state,'colour','fuzzy',now);
  assert.equal(recordSelfAssessment(state,'colour','wrong',now),null);
  assert.equal(state.mistakes.colour.count,1);
  nextQuestion(state.session,now);
  assert.equal(state.session.revealed,false);
  assert.equal(recordSelfAssessment(state,'coast','correct',now),null);
  assert.equal(state.session.answers.length,1);
});
test('自评跨轮每日去重，模糊词答对后保留错题记录', () => {
  const state = setup({mode:'en-zh'},[words[0]]);
  revealMeaning(state.session,'colour',now);
  recordSelfAssessment(state,'colour','fuzzy',now);
  state.session = startSession([words[0]],{...options,mode:'en-zh'},now);
  revealMeaning(state.session,'colour',now);
  recordSelfAssessment(state,'colour','correct',now);
  assert.equal(dailyCount(state,new Date(now)),1);
  assert.equal(state.mistakes.colour.count,1);
  assert.deepEqual(state.stats.colour,{attempts:2,correct:1});
});
test('暂停和到时后不可揭示或自评，仅揭示后到时仍为未答', () => {
  const state = setup({mode:'en-zh',timed:true});
  togglePause(state.session,now);
  assert.equal(revealMeaning(state.session,'colour',now),false);
  assert.equal(recordSelfAssessment(state,'colour','wrong',now),null);
  togglePause(state.session,now);
  revealMeaning(state.session,'colour',now);
  assert.equal(recordSelfAssessment(state,'colour','correct',now+60000),null);
  assert.equal(state.session.reason,'timeout');
  assert.equal(state.session.answers.length,0);
  assert.equal(dailyCount(state,new Date(now)),0);
  assert.deepEqual(Object.keys(state.mistakes),[]);
});
test('刷新恢复已显示的意思和三档评价，旧练习记录仍兼容', () => {
  const ids = new Set(words.map(w=>w.id));
  const state = setup({mode:'en-zh'});
  revealMeaning(state.session,'colour',now);
  const restored = readState(JSON.stringify(state),ids);
  assert.equal(restored.session.revealed,true);
  recordSelfAssessment(restored,'colour','fuzzy',now);
  assert.equal(readState(JSON.stringify(restored),ids).session.answers[0].rating,'fuzzy');
  const legacy = setup({mode:'en-zh'});
  delete legacy.session.revealed;
  legacy.session.answers.push({wordId:'colour',input:'颜色',correct:true,skipped:false,at:now});
  const old = readState(JSON.stringify(legacy),ids);
  assert.equal(old.session.answers[0].input,'颜色');
  assert.deepEqual(answerCounts(old.session.answers),{correct:1,fuzzy:0,wrong:0});
});
test('混合模式只有回忆题能自评，其他题仍按英文答案判分', () => {
  const state = setup({mode:'mixed'});
  for (const question of state.session.questions) {
    const word = words.find(w=>w.id===question.wordId);
    if (question.type === 'en-zh') {
      revealMeaning(state.session,word.id,now);
      recordSelfAssessment(state,word.id,'fuzzy',now);
    } else {
      assert.equal(revealMeaning(state.session,word.id,now),false);
      assert.equal(recordSelfAssessment(state,word.id,'correct',now),null);
      assert.equal(recordAnswer(state,word,word.word,false,now).correct,true);
    }
    nextQuestion(state.session,now);
  }
  assert.deepEqual(answerCounts(state.session.answers),{correct:2,fuzzy:1,wrong:0});
});
test('不一致的自评记录使旧轮次失效，但保留学习笔记', () => {
  const state = setup({mode:'en-zh'}); state.notes.colour='保留';
  revealMeaning(state.session,'colour',now);
  recordSelfAssessment(state,'colour','fuzzy',now);
  state.session.answers[0].correct=true;
  const restored=readState(JSON.stringify(state),new Set(words.map(w=>w.id)));
  assert.equal(restored.session,null);
  assert.equal(restored.notes.colour,'保留');
});
test('公开示例覆盖22章，唯一词条、完整中英例句且无空章节', async () => {
  const demo = JSON.parse(await readFile(new URL('../data/demo.json',import.meta.url),'utf8'));
  assert.equal(demo.chapters.length,22);
  assert.equal(demo.words.length,54);
  assert.equal(new Set(demo.words.map(w=>w.id)).size,demo.words.length);
  assert(demo.chapters.every(c=>demo.words.some(w=>w.chapters.includes(c.id))));
  assert(demo.words.every(w=>w.word && w.meanings.length && w.phonetic && w.example && w.translation));
});
test('解析器拒绝损坏或不完整的候选词库', () => {
  assert.throws(() => parseVocabulary('自然地理\n+++\natmosphere|n.|大气'));
});
test('本地完整词表如存在，则验证所有章节、去重和字段结构', async t => {
  let raw;
  try { raw = await readFile(new URL('../data/private/vocabulary.txt',import.meta.url),'utf8'); }
  catch(error) { if (error.code === 'ENOENT') {t.skip('公开仓库不包含本地第三方词表'); return;} throw error; }
  const result = parseVocabulary(raw);
  assert.equal(result.chapters.length,22);
  assert(result.words.length>3000);
  assert.equal(result.words.length,new Set(result.words.map(w=>w.id)).size);
  assert(result.chapters.every(c=>result.words.some(w=>w.chapters.includes(c.id))));
  assert(result.words.every(w=>w.word && w.pos && w.meanings.length && w.chapters.length));
});
