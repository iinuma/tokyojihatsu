import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import {
  adjacentStation,
  buildRailwayOrder,
  disambiguate,
} from '../scripts/lib/direction-label.js';
import type { OdptRailway } from '../src/odpt/types.js';

const OUTER = 'odpt.RailDirection:OuterLoop';
const INNER = 'odpt.RailDirection:InnerLoop';
const S = (name: string) => `odpt.Station:JR-East.Yamanote.${name}`;

/**
 * 山手線の並びを縮めたもの。実データと同じく**始点の大崎が両端に現れる**。
 * ascending が外回りであることは列車時刻表で実測確認済み。
 */
const YAMANOTE = {
  'owl:sameAs': 'odpt.Railway:JR-East.Yamanote',
  'odpt:ascendingRailDirection': OUTER,
  'odpt:descendingRailDirection': INNER,
  'odpt:stationOrder': [
    { 'odpt:station': S('Osaki'), 'odpt:index': 1 },
    { 'odpt:station': S('Gotanda'), 'odpt:index': 2 },
    { 'odpt:station': S('Tamachi'), 'odpt:index': 3 },
    { 'odpt:station': S('TakanawaGateway'), 'odpt:index': 4 },
    { 'odpt:station': S('Shinagawa'), 'odpt:index': 5 },
    { 'odpt:station': S('Osaki'), 'odpt:index': 6 },
  ],
} as unknown as OdptRailway;

const NAMES: Record<string, string> = {
  [S('Osaki')]: '大崎',
  [S('Gotanda')]: '五反田',
  [S('Tamachi')]: '田町',
  [S('TakanawaGateway')]: '高輪ゲートウェイ',
  [S('Shinagawa')]: '品川',
};

describe('adjacentStation', () => {
  const order = buildRailwayOrder(YAMANOTE);

  it('外回りは index が増える向き（実データで確認した向き）', () => {
    // 外回り: 高輪ゲートウェイ → 品川 → 大崎
    assert.equal(adjacentStation(order, S('Shinagawa'), OUTER), S('Osaki'));
  });

  it('内回りは index が減る向き', () => {
    // 内回り: 大崎 → 品川 → 高輪ゲートウェイ
    assert.equal(adjacentStation(order, S('Shinagawa'), INNER), S('TakanawaGateway'));
  });

  it('環状線の始点は並びの両端から隣を引ける', () => {
    // 大崎は index 1 と 6 の両方にある。内回り（-1）は index 1 では引けないが
    // index 6 から品川が引ける。
    assert.equal(adjacentStation(order, S('Osaki'), INNER), S('Shinagawa'));
    assert.equal(adjacentStation(order, S('Osaki'), OUTER), S('Gotanda'));
  });

  it('知らない方面 ID では引かない', () => {
    assert.equal(adjacentStation(order, S('Shinagawa'), 'odpt.RailDirection:Unknown'), undefined);
  });

  it('並びに無い駅では引かない', () => {
    assert.equal(adjacentStation(order, S('Nowhere'), OUTER), undefined);
  });
});

describe('disambiguate', () => {
  const order = buildRailwayOrder(YAMANOTE);
  const nameOf = (id: string): string | undefined => NAMES[id];

  it('衝突した方面だけ隣の駅に差し替える', () => {
    // これが実際に起きていた状態。山手線の全 30 駅で両方向とも「大崎方面」だった。
    const result = disambiguate(
      [
        { id: INNER, title: '内回り', label: '大崎方面' },
        { id: OUTER, title: '外回り', label: '大崎方面' },
      ],
      { order, stationId: S('Shinagawa'), nameOf },
    );

    assert.equal(result[0]!.label, '高輪ゲートウェイ方面', '内回りは東京側へ向かう');
    assert.equal(result[1]!.label, '大崎方面', '外回りは大崎へ向かう');
    assert.notEqual(result[0]!.label, result[1]!.label, '区別がつく');
  });

  it('衝突していない方面には触らない', () => {
    const input = [
      { id: INNER, title: '内回り', label: '渋谷方面' },
      { id: OUTER, title: '外回り', label: '東京方面' },
    ];
    const result = disambiguate(input, { order, stationId: S('Shinagawa'), nameOf });
    assert.deepEqual(result, input);
  });

  it('隣の駅が引けなければ ODPT の方面名に落とす', () => {
    const result = disambiguate(
      [
        { id: INNER, title: '内回り', label: '大崎方面' },
        { id: OUTER, title: '外回り', label: '大崎方面' },
      ],
      { order: undefined, stationId: S('Shinagawa'), nameOf },
    );

    assert.equal(result[0]!.label, '内回り');
    assert.equal(result[1]!.label, '外回り');
    assert.notEqual(result[0]!.label, result[1]!.label, '少なくとも区別はつく');
  });

  it('3 方向以上が衝突しても全部差し替える', () => {
    const result = disambiguate(
      [
        { id: INNER, title: '内回り', label: '大崎方面' },
        { id: OUTER, title: '外回り', label: '大崎方面' },
        { id: 'odpt.RailDirection:Other', title: 'その他', label: '大崎方面' },
      ],
      { order, stationId: S('Shinagawa'), nameOf },
    );
    assert.equal(result[2]!.label, 'その他', '隣が引けないものは方面名へ');
  });
});
