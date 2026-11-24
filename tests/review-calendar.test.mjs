import test from 'node:test';
import assert from 'node:assert/strict';
import { addDays, learningDay, isDue, assertDay, assertTimeZone } from '../src/review/calendar.js';

test('日历按公历跨月、跨年和闰日运算', () => {
  for (const [day, n, expected] of [['2026-01-31',1,'2026-02-01'],['2026-12-31',1,'2027-01-01'],
    ['2024-02-28',1,'2024-02-29'],['2024-02-29',1,'2024-03-01'],['2026-03-01',-1,'2026-02-28']]) {
    assert.equal(addDays(day,n),expected);
  }
  assert.equal(isDue('2026-01-01','2026-01-01'),true);
  assert.equal(isDue('2026-01-02','2026-01-01'),false);
});

test('固定学习时区独立于设备时区，支持夏令时前进和回拨', () => {
  const at=Date.parse('2026-11-20T00:30:00Z');
  assert.equal(learningDay(at,'Asia/Shanghai'),'2026-11-20');
  assert.equal(learningDay(at,'America/Los_Angeles'),'2026-11-19');
  for (const at of ['2026-03-08T06:59:00Z','2026-03-08T07:01:00Z']) {
    assert.equal(learningDay(Date.parse(at),'America/New_York'),'2026-03-08');
  }
  for (const at of ['2026-11-01T05:59:00Z','2026-11-01T06:01:00Z']) {
    assert.equal(learningDay(Date.parse(at),'America/New_York'),'2026-11-01');
  }
  assert.equal(addDays('2026-03-08',1),'2026-03-09');
  assert.equal(addDays('2026-11-01',1),'2026-11-02');
});

test('非法日期、时区、时间和间隔明确拒绝', () => {
  for (const day of ['2026-02-29','2026-04-31','2026-13-01','2026-1-01','0000-01-01',null]) assert.throws(()=>assertDay(day));
  for (const zone of ['',null,'Mars/Olympus','+08:00']) assert.throws(()=>assertTimeZone(zone));
  for (const at of [NaN,Infinity,-1,'2026-01-01']) assert.throws(()=>learningDay(at,'UTC'));
  assert.throws(()=>addDays('9999-12-31',1));
  assert.throws(()=>addDays('2026-01-01',1.5));
});
