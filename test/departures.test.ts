import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { findNextDepartures, formatCountdown } from '../src/core/departures.js';
import type { OdptStationTimetable, OdptTimetableObject } from '../src/odpt/types.js';

function departure(time: string, extra: Partial<OdptTimetableObject> = {}): OdptTimetableObject {
  return { 'odpt:departureTime': time, ...extra };
}

function timetable(
  calendar: string,
  times: OdptTimetableObject[],
): OdptStationTimetable {
  return {
    'owl:sameAs': `test.${calendar}`,
    'odpt:station': 'odpt.Station:Test.Line.A',
    'odpt:railway': 'odpt.Railway:Test.Line',
    'odpt:operator': 'odpt.Operator:Test',
    'odpt:calendar': calendar,
    'odpt:stationTimetableObject': times,
  };
}

/** JST の時刻を Date にする。 */
function jst(iso: string): Date {
  return new Date(`${iso}+09:00`);
}

const WEEKDAY = timetable('odpt.Calendar:Weekday', [
  departure('05:05'),
  departure('08:00', { 'odpt:destinationStation': ['odpt.Station:Test.Line.Z'] }),
  departure('23:58'),
  departure('00:07'), // 日跨ぎ
  departure('00:21', { 'odpt:isLast': true }),
]);

const SATURDAY_HOLIDAY = timetable('odpt.Calendar:SaturdayHoliday', [
  departure('06:00'),
  departure('09:30'),
]);

describe('次発の算出', () => {
  it('現在時刻以降の発車を近い順に返す', () => {
    const result = findNextDepartures([WEEKDAY, SATURDAY_HOLIDAY], {
      now: jst('2026-09-24T07:00:00'), // 木曜
      count: 2,
    });
    assert.equal(result.length, 2);
    assert.equal(result[0]?.displayTime, '08:00');
    assert.equal(result[1]?.displayTime, '23:58');
  });

  it('0 時台の終電を前日サービス日の 24 時台として扱う', () => {
    const result = findNextDepartures([WEEKDAY], {
      now: jst('2026-09-24T23:50:00'),
      count: 3,
    });
    assert.deepEqual(
      result.map((d) => d.displayTime),
      ['23:58', '24:07', '24:21'],
    );
    // 時刻表上の表記は 00:07 のまま保つ
    assert.equal(result[1]?.scheduledTime, '00:07');
    assert.equal(result[2]?.isLast, true);
  });

  it('日付が変わった直後も前日ダイヤの終電を出す', () => {
    const result = findNextDepartures([WEEKDAY], {
      now: jst('2026-09-25T00:15:00'), // 金曜の 0:15＝木曜ダイヤの継続
      count: 1,
    });
    assert.equal(result[0]?.displayTime, '24:21');
    assert.equal(result[0]?.serviceDate, '2026-09-24');
  });

  it('終電後は翌朝の始発に繰り上がる', () => {
    const result = findNextDepartures([WEEKDAY], {
      now: jst('2026-09-25T02:00:00'),
      count: 1,
    });
    assert.equal(result[0]?.displayTime, '05:05');
    assert.equal(result[0]?.serviceDate, '2026-09-25');
  });

  it('祝日は土休日ダイヤを使う', () => {
    const result = findNextDepartures([WEEKDAY, SATURDAY_HOLIDAY], {
      now: jst('2026-09-21T07:00:00'), // 敬老の日
      count: 1,
    });
    assert.equal(result[0]?.displayTime, '09:30');
    assert.equal(result[0]?.calendar, 'odpt.Calendar:SaturdayHoliday');
  });

  it('Saturday を持つ路線では土曜に Saturday を優先する', () => {
    const saturdayOnly = timetable('odpt.Calendar:Saturday', [departure('10:00')]);
    const holidayOnly = timetable('odpt.Calendar:Holiday', [departure('10:30')]);

    const saturday = findNextDepartures([saturdayOnly, holidayOnly], {
      now: jst('2026-09-26T09:00:00'), // 土曜
      count: 1,
    });
    assert.equal(saturday[0]?.calendar, 'odpt.Calendar:Saturday');

    const sunday = findNextDepartures([saturdayOnly, holidayOnly], {
      now: jst('2026-09-27T09:00:00'), // 日曜
      count: 1,
    });
    assert.equal(sunday[0]?.calendar, 'odpt.Calendar:Holiday');
  });

  it('行先・種別のラベルを解決する', () => {
    const result = findNextDepartures([WEEKDAY], {
      now: jst('2026-09-24T07:00:00'),
      count: 1,
      resolveLabel: (id) => (id === 'odpt.Station:Test.Line.Z' ? '終点' : undefined),
    });
    assert.equal(result[0]?.destination, '終点');
  });

  it('該当する時刻表がなければ空を返す', () => {
    const result = findNextDepartures([], { now: jst('2026-09-24T07:00:00') });
    assert.deepEqual(result, []);
  });
});

describe('残り時間の表示', () => {
  it('1 時間未満は 分:秒', () => {
    assert.equal(formatCountdown(222_000), '3:42');
    assert.equal(formatCountdown(59_000), '0:59');
  });

  it('1 時間以上は 時:分:秒', () => {
    assert.equal(formatCountdown(3_750_000), '1:02:30');
  });

  it('過ぎた時刻は 0:00 に丸める', () => {
    assert.equal(formatCountdown(-5_000), '0:00');
  });
});
