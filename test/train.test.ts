import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import {
  buildDelayIndex,
  delayFor,
  formatDelay,
  isDelayIndexUsable,
  progressBar,
  stationKey,
} from '../src/core/train.js';
import type { OdptTrain } from '../src/odpt/types.js';

function train(
  number: string,
  delay: number,
  options: { date?: string; valid?: string } = {},
): OdptTrain {
  return {
    'owl:sameAs': `odpt.Train:Toei.Oedo.${number}`,
    'dc:date': options.date ?? '2026-09-24T07:54:00+09:00',
    'dct:valid': options.valid ?? '2026-09-24T07:59:00+09:00',
    'odpt:operator': 'odpt.Operator:Toei',
    'odpt:railway': 'odpt.Railway:Toei.Oedo',
    'odpt:trainNumber': number,
    'odpt:delay': delay,
  };
}

const NOW = new Date('2026-09-24T07:55:00+09:00');

describe('遅延の索引', () => {
  it('列車番号から遅延を引ける', () => {
    const index = buildDelayIndex([train('601A', 0), train('602A', 120)]);
    assert.equal(delayFor(index, '601A', NOW), 0);
    assert.equal(delayFor(index, '602A', NOW), 120);
  });

  it('知らない列車番号は null', () => {
    const index = buildDelayIndex([train('601A', 0)]);
    assert.equal(delayFor(index, '999X', NOW), null);
  });

  it('列車番号が無ければ null', () => {
    const index = buildDelayIndex([train('601A', 0)]);
    assert.equal(delayFor(index, undefined, NOW), null);
  });

  it('位置データを出していない路線では使えない扱いにする', () => {
    // 東京メトロなど。索引が空になり、遅延なしとして動く
    const index = buildDelayIndex([]);
    assert.equal(isDelayIndexUsable(index, NOW), false);
    assert.equal(delayFor(index, '601A', NOW), null);
  });
});

describe('データの鮮度', () => {
  it('期限内なら使える', () => {
    const index = buildDelayIndex([train('601A', 0)]);
    assert.equal(isDelayIndexUsable(index, NOW), true);
  });

  it('期限を過ぎたら使わない', () => {
    // ガイドライン 2.1「有効範囲を超えたデータを使わない」
    const index = buildDelayIndex([train('601A', 60)]);
    const after = new Date('2026-09-24T08:00:00+09:00');
    assert.equal(isDelayIndexUsable(index, after), false);
    assert.equal(delayFor(index, '601A', after), null);
  });

  it('一部でも古ければ塊ごと古い扱いにする', () => {
    // 期限は最も早いものを採る
    const index = buildDelayIndex([
      train('601A', 0, { valid: '2026-09-24T07:59:00+09:00' }),
      train('602A', 0, { valid: '2026-09-24T07:56:00+09:00' }),
    ]);
    assert.equal(isDelayIndexUsable(index, new Date('2026-09-24T07:57:00+09:00')), false);
  });

  it('生成時刻は最も古いものを採る', () => {
    const index = buildDelayIndex([
      train('601A', 0, { date: '2026-09-24T07:54:00+09:00' }),
      train('602A', 0, { date: '2026-09-24T07:52:00+09:00' }),
    ]);
    assert.equal(index.generatedAt?.toISOString(), new Date('2026-09-24T07:52:00+09:00').toISOString());
  });
});

describe('遅延の表示', () => {
  it('定刻なら何も出さない', () => {
    // 「0分遅れ」と書くと、かえって遅れているように読める
    assert.equal(formatDelay(0), null);
    assert.equal(formatDelay(-10), null);
  });

  it('1分未満でも遅れていることは伝える', () => {
    assert.equal(formatDelay(20), '約1分遅れ');
  });

  it('分に丸める', () => {
    assert.equal(formatDelay(60), '1分遅れ');
    assert.equal(formatDelay(150), '3分遅れ');
    assert.equal(formatDelay(600), '10分遅れ');
  });
});

describe('駅 ID の短縮', () => {
  it('末尾を取り出す', () => {
    assert.equal(stationKey('odpt.Station:Toei.Oedo.Roppongi'), 'Roppongi');
  });

  it('空なら null', () => {
    assert.equal(stationKey(null), null);
    assert.equal(stationKey(undefined), null);
  });
});

describe('進捗バー', () => {
  it('両端と中央', () => {
    assert.equal(progressBar(0, 5), '●────');
    assert.equal(progressBar(1, 5), '────●');
    assert.equal(progressBar(0.5, 5), '───●─'.slice(0, 5));
  });

  it('範囲外でも崩れない', () => {
    assert.equal(progressBar(-1, 5).length, 5);
    assert.equal(progressBar(2, 5).length, 5);
  });
});
