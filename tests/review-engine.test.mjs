import test from 'node:test';
import assert from 'node:assert/strict';
import { mapPracticeResult, practiceEvent } from '../src/review/engine.js';

test('实际题型逐题映射，跳过、未答和仅揭示没有评价',()=>{
  for (const type of ['zh-en','listening']) {
    assert.equal(mapPracticeResult({type,wordId:'w'},{wordId:'w',correct:true,skipped:false}),'good');
    assert.equal(mapPracticeResult({type,wordId:'w'},{wordId:'w',correct:false,skipped:false}),'again');
  }
  for (const [rating,grade] of [['correct','good'],['fuzzy','hard'],['wrong','again']]) {
    assert.equal(mapPracticeResult({type:'en-zh',wordId:'w'},{wordId:'w',rating,correct:rating==='correct',skipped:false}),grade);
  }
  assert.equal(mapPracticeResult({type:'en-zh'},null),null);
  assert.equal(mapPracticeResult({type:'listening'},{skipped:true}),null);
  assert.equal(mapPracticeResult({type:'mixed'},{}),null);
  assert.throws(()=>mapPracticeResult({type:'en-zh',wordId:'w'},{wordId:'w',correct:true,rating:'fuzzy',skipped:false}));
  assert.throws(()=>mapPracticeResult({type:'zh-en',wordId:'w'},{wordId:'other',correct:true,skipped:false}));
  assert.equal(practiceEvent({sessionId:'s',source:'chapter',questions:[{type:'zh-en',wordId:'w'}],answers:[]},0),null);
});
