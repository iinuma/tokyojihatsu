import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import {
  aboutText,
  headerText,
  clockText,
  countdownTexts,
  directionPickerPage,
  stationPickerPage,
} from '../app/src/screens.js';
import { truncateItem, visualWidth, padCenter, padToColumn } from '../app/src/layout.js';
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
  license: 'basic',
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

  it('駅名は左端から、距離は同じ桁から始める', () => {
    const page = stationPickerPage(nearby);
    const items = page.listObject?.[0]?.itemContainer?.itemName ?? [];
    // 駅名の長さが違っても距離の開始位置が揃う
    const starts = items.map((item) => item.indexOf(item.trim().split(/\s+/)[1]!));
    assert.equal(visualWidth(items[0]!.slice(0, starts[0])), 20);
    assert.equal(visualWidth(items[1]!.slice(0, starts[1])), 20);
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
    // 駅・路線・方面は上段へ移した
    // 22 桁に収まらないので路線名が落ちる
    assert.equal(texts.header, '月島 光が丘方面');
  });

  it('終電には印を付ける', () => {
    const texts = countdownTexts(station, direction, [departure('24:21', 5, true)], now);
    assert.equal(texts.upcoming, '次発 24:21 (終)');
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
    // 遅延を反映しない旨はカウントダウン画面から外してこちらに置いた
    assert.match(text, /遅延情報が/);
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

  it('指定の桁まで空白で埋める', () => {
    assert.equal(visualWidth(padToColumn('月島', 20)), 20);
    assert.equal(visualWidth(padToColumn('品川シーサイド', 20)), 20);
  });

  it('桁を超える駅名は切らずに空白 1 つだけ足す', () => {
    // 切ると読めなくなるので溢れさせる
    const long = padToColumn('東京国際クルーズターミナル', 20);
    assert.equal(long, '東京国際クルーズターミナル ');
  });

  it('List の 1 項目を上限で切る', () => {
    assert.equal(truncateItem('abc', 10), 'abc');
    assert.equal(truncateItem('a'.repeat(70)).length, 60);
    assert.ok(truncateItem('a'.repeat(70)).endsWith('…'));
  });
});

describe('徒歩圏に対応駅がないとき', () => {
  it('見出しを差し替えられる', () => {
    const far = [
      {
        group: { name: '西馬込', lat: 0, lng: 0, entries: [] },
        distanceMeters: 6430,
        distanceLabel: '6.4km',
      },
    ];
    const page = stationPickerPage(far, '徒歩圏になし・最寄りの駅');
    assert.equal(page.textObject?.[0]?.content, '徒歩圏になし・最寄りの駅');
    const items = page.listObject?.[0]?.itemContainer?.itemName ?? [];
    assert.equal(items.length, 1);
    assert.ok(items[0]!.startsWith('西馬込'));
    assert.ok(items[0]!.endsWith('6.4km'));
    assert.equal(visualWidth(items[0]!.replace(/6\.4km$/, '')), 20);
  });

  it('見出しを省くと「近くの駅」になる', () => {
    assert.equal(stationPickerPage([]).textObject?.[0]?.content, '近くの駅');
  });
});

describe('左上の時計', () => {
  it('日・曜日・時分秒を JST で出す', () => {
    // 2026-09-22 05:26:13 JST = 2026-09-21 20:26:13 UTC
    const at = Date.parse('2026-09-21T20:26:13Z');
    assert.equal(clockText(at), '09/22(火) 05:26:13');
  });

  it('日付をまたぐ時刻でも JST で判定する', () => {
    // UTC では 21 日だが JST では 22 日
    assert.match(clockText(Date.parse('2026-09-21T15:00:00Z')), /^09\/22\(火\) 00:00:00$/);
  });

  it('カウントダウン画面に時計が含まれる', () => {
    const texts = countdownTexts(station, direction, [], Date.parse('2026-09-21T20:26:13Z'));
    assert.equal(texts.clock, '09/22(火) 05:26:13');
  });
});

describe('取得に失敗しているとき', () => {
  it('黙って「次の電車なし」にせず、取得中だと示す', () => {
    // 失敗を握り潰すと、利用者には「止まった」ようにしか見えない
    const stale = countdownTexts(station, direction, [], Date.now(), { stale: true });
    assert.match(stale.remaining, /時刻表を取得中/);

    const normal = countdownTexts(station, direction, [], Date.now());
    assert.match(normal.remaining, /次の電車なし/);
  });
});

describe('チャレンジ限定データを含むとき', () => {
  it('期限を「データについて」に明示する', () => {
    const text = aboutText('2026-07-17', 'dev@example.com', {
      challengeExpiresAt: '2027-03-12',
    });
    assert.match(text, /チャレンジ限定ライセンス/);
    assert.match(text, /2027-03-12/);
  });

  it('含まないときは触れない', () => {
    const text = aboutText('2026-07-17', 'dev@example.com');
    assert.equal(/チャレンジ限定/.test(text), false);
  });
});

describe('上段の駅・方面', () => {
  const longStation: MasterStation = {
    ...station,
    name: '東京国際クルーズターミナル',
    railwayName: 'ゆりかもめ',
  };

  it('入るなら路線名まで出す', () => {
    const text = headerText(station, direction);
    // 22 桁に収まらないので路線名が落ちる
    assert.equal(text, '月島 光が丘方面');
    assert.ok(visualWidth(text) <= 22);
  });

  it('入らなければ路線名を落とす', () => {
    const text = headerText(longStation, { ...direction, label: '新橋方面' });
    assert.equal(text.includes('ゆりかもめ'), false);
    assert.ok(visualWidth(text) <= 22, `${visualWidth(text)} 桁`);
  });

  it('それでも入らなければ幅で切る（文字数ではなく）', () => {
    // 全角ばかりの駅名を文字数で切ると実際の 2 倍の幅になって溢れる
    const text = headerText(longStation, { ...direction, label: '国際展示場方面' });
    assert.ok(visualWidth(text) <= 22, `${visualWidth(text)} 桁: ${text}`);
    assert.ok(text.endsWith('…'));
  });
});

describe('遅延の表示', () => {
  const now = Date.now();

  function delayed(time: string, minutesFromNow: number, delaySeconds: number): Departure {
    return {
      at: new Date(now + minutesFromNow * 60_000),
      scheduledTime: time,
      displayTime: time,
      isLast: false,
      serviceDate: '2026-09-24',
      calendar: 'odpt.Calendar:Weekday',
      delaySeconds,
    };
  }

  it('遅れている発車に印を付ける', () => {
    const texts = countdownTexts(station, direction, [delayed('07:57', 3, 120)], now);
    assert.equal(texts.upcoming.split('\n')[0], '次発 07:57 (2分遅れ)');
  });

  it('定刻には何も付けない', () => {
    const texts = countdownTexts(station, direction, [delayed('07:57', 3, 0)], now);
    assert.equal(texts.upcoming.split('\n')[0], '次発 07:57');
  });

  it('終電と遅延が重なれば両方出す', () => {
    const last = { ...delayed('24:21', 5, 60), isLast: true };
    const texts = countdownTexts(station, direction, [last], now);
    assert.equal(texts.upcoming.split('\n')[0], '次発 24:21 (終 1分遅れ)');
  });

  it('遅れているときは、その時点の遅れだと分かるように書く', () => {
    // 開発者ガイドライン 2.1 が求めるデータ生成時刻でもある
    const texts = countdownTexts(station, direction, [delayed('07:57', 3, 60)], now, {
      delayGeneratedAt: new Date('2026-09-24T07:54:00+09:00'),
    });
    assert.ok(texts.upcoming.includes('07:54時点の遅れ'), texts.upcoming);
  });

  it('遅れていないときは「遅れなし」と書く', () => {
    // 時刻だけだと、定刻なのか遅れているのかが読み取れない
    const texts = countdownTexts(station, direction, [delayed('07:57', 3, 0)], now, {
      delayGeneratedAt: new Date('2026-09-24T07:54:00+09:00'),
    });
    assert.ok(texts.upcoming.includes('07:54時点 遅れなし'), texts.upcoming);
  });

  it('遅延が取れない路線では生成時刻も出さない', () => {
    const texts = countdownTexts(station, direction, [delayed('07:57', 3, 0)], now);
    assert.equal(texts.upcoming.includes('時点'), false);
  });
});
