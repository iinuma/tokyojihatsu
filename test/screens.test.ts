import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import {
  aboutText,
  countdownTexts,
  directionPickerPage,
  stationPickerPage,
} from '../app/src/screens.js';
import { truncateItem, visualWidth, padCenter } from '../app/src/layout.js';
import type { Departure } from '../src/core/departures.js';
import type { MasterDirection, MasterStation } from '../src/core/master.js';

const station: MasterStation = {
  id: 'odpt.Station:Toei.Oedo.Tsukishima',
  name: '月島',
  lat: 35.663757,
  lng: 139.783912,
  operator: 'odpt.Operator:Toei',
  operatorName: '都営',
  railway: 'odpt.Railway:Toei.Oedo',
  railwayName: '大江戸線',
  directions: [],
};

const direction: MasterDirection = {
  id: 'odpt.RailDirection:OuterLoop',
  title: '外回り',
  label: '光が丘方面',
  timetables: {},
};

function departure(time: string, minutesFromNow: number, isLast = false): Departure {
  return {
    at: new Date(Date.now() + minutesFromNow * 60_000),
    scheduledTime: time,
    displayTime: time,
    isLast,
    serviceDate: '2026-09-21',
    calendar: 'odpt.Calendar:Weekday',
  };
}

describe('駅選択画面', () => {
  const nearby = [
    { group: { name: '月島', lat: 0, lng: 0, entries: [] }, distanceMeters: 60, distanceLabel: '60m' },
    { group: { name: '勝どき', lat: 0, lng: 0, entries: [] }, distanceMeters: 810, distanceLabel: '810m' },
  ];

  it('駅名と距離を並べる', () => {
    const page = stationPickerPage(nearby);
    const items = page.listObject?.[0]?.itemContainer?.itemName ?? [];
    assert.deepEqual(items, ['月島  60m', '勝どき  810m']);
  });

  it('List の上限 20 件で打ち切る', () => {
    const many = Array.from({ length: 30 }, (_, i) => ({
      group: { name: `駅${i}`, lat: 0, lng: 0, entries: [] },
      distanceMeters: i,
      distanceLabel: `${i}m`,
    }));
    const items = stationPickerPage(many).listObject?.[0]?.itemContainer?.itemName ?? [];
    assert.equal(items.length, 20);
  });

  it('入力を受けるコンテナがちょうど 1 つある', () => {
    const page = stationPickerPage(nearby);
    const captures = [
      ...(page.textObject ?? []).map((t) => t.isEventCapture),
      ...(page.listObject ?? []).map((l) => l.isEventCapture),
    ].filter((v) => v === 1);
    assert.equal(captures.length, 1);
  });
});

describe('方面選択画面', () => {
  it('路線名と方面を並べる', () => {
    const page = directionPickerPage('月島', [
      { station, direction, label: 'x' },
      { station, direction: { ...direction, label: '都庁前方面' }, label: 'y' },
    ]);
    const items = page.listObject?.[0]?.itemContainer?.itemName ?? [];
    assert.deepEqual(items, ['大江戸線・光が丘方面', '大江戸線・都庁前方面']);
  });

  it('見出しに駅名を出す', () => {
    const page = directionPickerPage('月島', []);
    assert.equal(page.textObject?.[0]?.content, '月島');
  });
});

describe('カウントダウン画面', () => {
  const now = Date.now();

  it('残り時間・次発・次々発を出す', () => {
    const texts = countdownTexts(station, direction, [departure('20:23', 4), departure('20:30', 11)], now);
    assert.match(texts.remaining, /あと 3:5\d|あと 4:00/);
    assert.equal(texts.upcoming, '次発 20:23\n次々発 20:30');
    assert.equal(texts.footer, '月島　大江戸線・光が丘方面\n時刻表ベース');
  });

  it('終電には印を付ける', () => {
    const texts = countdownTexts(station, direction, [departure('24:21', 5, true)], now);
    assert.equal(texts.upcoming, '次発 24:21 終');
  });

  it('次発がなければその旨を出す', () => {
    const texts = countdownTexts(station, direction, [], now);
    assert.match(texts.remaining, /次の電車なし/);
    assert.equal(texts.upcoming, '終電後');
  });

  it('1 本しかなければ次々発の行を出さない', () => {
    const texts = countdownTexts(station, direction, [departure('20:23', 4)], now);
    assert.equal(texts.upcoming, '次発 20:23');
  });
});

describe('データについての画面', () => {
  it('ODPT ガイドラインで要る 3 点と取得日時を含む', () => {
    const text = aboutText('2026-05-28T15:00:00+09:00', 'dev@example.com');
    assert.match(text, /公共交通オープンデータセンター/);
    assert.match(text, /保証されていません/);
    assert.match(text, /dev@example.com/);
    assert.match(text, /2026-05-28/);
  });
});

describe('表示ヘルパー', () => {
  it('全角を 2 幅として数える', () => {
    assert.equal(visualWidth('月島'), 4);
    assert.equal(visualWidth('abc'), 3);
    assert.equal(visualWidth('月島駅 A'), 8);
  });

  it('中央寄せは左に空白を足す', () => {
    assert.equal(padCenter('あと 3:42', 20), '     あと 3:42');
    assert.equal(padCenter('x'.repeat(30), 20), 'x'.repeat(30)); // 入らなければそのまま
  });

  it('List の 1 項目を上限で切る', () => {
    assert.equal(truncateItem('abc', 10), 'abc');
    assert.equal(truncateItem('a'.repeat(70)).length, 60);
    assert.ok(truncateItem('a'.repeat(70)).endsWith('…'));
  });
});
