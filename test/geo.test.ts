import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { distanceMeters, formatDistance, nearest } from '../src/core/geo.js';

const TSUKISHIMA = { lat: 35.663757, lng: 139.783912 };
const KACHIDOKI = { lat: 35.658869, lng: 139.777969 };

describe('距離計算', () => {
  it('月島〜勝どきが実距離に近い（約 750m）', () => {
    const meters = distanceMeters(TSUKISHIMA, KACHIDOKI);
    assert.ok(meters > 700 && meters < 850, `${meters}m`);
  });

  it('同一地点は 0', () => {
    assert.equal(Math.round(distanceMeters(TSUKISHIMA, TSUKISHIMA)), 0);
  });
});

describe('近傍検索', () => {
  const points = [
    { name: '近い', ...TSUKISHIMA },
    { name: '中くらい', ...KACHIDOKI },
    { name: '遠い', lat: 35.0, lng: 139.0 },
  ];

  it('近い順に並べ、範囲外を落とす', () => {
    const result = nearest(TSUKISHIMA, points, { maxDistanceMeters: 2000 });
    assert.deepEqual(result.map((r) => r.item.name), ['近い', '中くらい']);
  });

  it('limit で件数を絞る', () => {
    assert.equal(nearest(TSUKISHIMA, points, { limit: 1 }).length, 1);
  });
});

describe('距離の表示', () => {
  it('1km 未満は 10m 単位の m 表記', () => {
    assert.equal(formatDistance(62), '60m');
    assert.equal(formatDistance(814), '810m');
  });

  it('1km 以上は km 表記', () => {
    assert.equal(formatDistance(1500), '1.5km');
    assert.equal(formatDistance(1150), '1.1km');
  });
});
