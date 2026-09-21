import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { calendarFor, holidayName, toJstParts } from '../src/core/calendar.js';

describe('祝日判定', () => {
  it('固定日の祝日を返す', () => {
    assert.equal(holidayName({ year: 2026, month: 1, day: 1 }), '元日');
    assert.equal(holidayName({ year: 2026, month: 11, day: 3 }), '文化の日');
  });

  it('ハッピーマンデーを年ごとに計算する', () => {
    assert.equal(holidayName({ year: 2025, month: 1, day: 13 }), '成人の日');
    assert.equal(holidayName({ year: 2026, month: 1, day: 12 }), '成人の日');
    assert.equal(holidayName({ year: 2027, month: 1, day: 11 }), '成人の日');
  });

  it('春分・秋分を年ごとに計算する', () => {
    assert.equal(holidayName({ year: 2026, month: 3, day: 20 }), '春分の日');
    assert.equal(holidayName({ year: 2027, month: 3, day: 21 }), '春分の日');
    assert.equal(holidayName({ year: 2026, month: 9, day: 23 }), '秋分の日');
  });

  it('日曜の祝日に振替休日を作る', () => {
    // 2026-05-03(日) 憲法記念日 → 5/4, 5/5 も祝日なので 5/6(水) が振替
    assert.equal(holidayName({ year: 2026, month: 5, day: 6 }), '振替休日');
    // 2025-11-23(日) 勤労感謝の日 → 11/24(月)
    assert.equal(holidayName({ year: 2025, month: 11, day: 24 }), '振替休日');
  });

  it('祝日に挟まれた平日を国民の休日にする', () => {
    // 2026: 敬老の日 9/21(月) と 秋分の日 9/23(水) に挟まれた 9/22(火)
    assert.equal(holidayName({ year: 2026, month: 9, day: 22 }), '国民の休日');
    // 2027: 敬老の日 9/20(月) と 秋分の日 9/23(木) は 2 日空くので該当しない
    assert.equal(holidayName({ year: 2027, month: 9, day: 22 }), null);
  });

  it('平日は祝日ではない', () => {
    assert.equal(holidayName({ year: 2026, month: 9, day: 24 }), null);
  });
});

describe('カレンダー種別の判定', () => {
  it('平日は Weekday だけを候補にする', () => {
    const decision = calendarFor({ year: 2026, month: 9, day: 24 });
    assert.deepEqual(decision.candidates, ['odpt.Calendar:Weekday']);
    assert.equal(decision.reason, '平日');
  });

  it('土曜は Saturday を優先し SaturdayHoliday にフォールバックする', () => {
    const decision = calendarFor({ year: 2026, month: 9, day: 26 });
    assert.deepEqual(decision.candidates, [
      'odpt.Calendar:Saturday',
      'odpt.Calendar:SaturdayHoliday',
    ]);
    assert.equal(decision.reason, '土曜');
  });

  it('日曜・祝日は Holiday を優先する', () => {
    for (const date of [
      { year: 2026, month: 9, day: 27 }, // 日曜
      { year: 2026, month: 9, day: 21 }, // 敬老の日
    ]) {
      assert.deepEqual(calendarFor(date).candidates, [
        'odpt.Calendar:Holiday',
        'odpt.Calendar:SaturdayHoliday',
      ]);
    }
    assert.equal(calendarFor({ year: 2026, month: 9, day: 21 }).reason, '敬老の日');
  });
});

describe('JST への変換', () => {
  it('UTC 深夜を翌日の JST 午前として扱う', () => {
    const parts = toJstParts(new Date('2026-09-21T15:30:00Z'));
    assert.deepEqual(
      { year: parts.year, month: parts.month, day: parts.day, hour: parts.hour },
      { year: 2026, month: 9, day: 22, hour: 0 },
    );
  });
});
