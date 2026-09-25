import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { renderStationMap, type MapStation } from '../src/core/stationmap.js';
import { LEVEL } from '../src/core/bitmap.js';

/** 大門のあたり。スクリーンショットで使っている場所に合わせてある。 */
const DAIMON = { lat: 35.65742, lng: 139.75503 };

const WIDTH = 288;
const HEIGHT = 144;
const CENTER_X = (WIDTH - 1) / 2;
const CENTER_Y = (HEIGHT - 1) / 2;

function station(id: string, lat: number, lng: number): MapStation {
  return { id, name: id, lat, lng };
}

/** 緯度 1 度 ≒ 111km。メートルを度に直す雑な換算（テスト用）。 */
function north(meters: number): number {
  return DAIMON.lat + meters / 111_000;
}
function east(meters: number): number {
  return DAIMON.lng + meters / (111_000 * Math.cos((DAIMON.lat * Math.PI) / 180));
}

describe('renderStationMap', () => {
  it('駅が無くても落ちない', () => {
    const result = renderStationMap({
      width: WIDTH,
      height: HEIGHT,
      origin: DAIMON,
      stations: [],
    });
    assert.equal(result.plotted.length, 0);
    assert.equal(result.rangeMeters, 0);
  });

  it('現在地は常に中心にある', () => {
    // 外接矩形に合わせると、いる場所で自分の位置が動いて読み方が毎回変わる。
    const result = renderStationMap({
      width: WIDTH,
      height: HEIGHT,
      origin: DAIMON,
      stations: [station('a', north(800), east(600))],
    });

    // 中心の十字。真ん中の 1 画素だけは空けてある。
    assert.equal(result.bitmap.get(CENTER_X, CENTER_Y), LEVEL.off, '中心は空けてある');
    assert.equal(result.bitmap.get(CENTER_X - 4, CENTER_Y), LEVEL.bright, '横棒がある');
    assert.equal(result.bitmap.get(CENTER_X, CENTER_Y - 4), LEVEL.bright, '縦棒がある');
  });

  it('真北の駅は中心の真上に出る（方向が保たれる）', () => {
    const result = renderStationMap({
      width: WIDTH,
      height: HEIGHT,
      origin: DAIMON,
      stations: [station('north', north(500), DAIMON.lng)],
    });

    const plotted = result.plotted[0]!;
    assert.ok(Math.abs(plotted.x - CENTER_X) < 1, `真上のはずが x=${plotted.x}`);
    assert.ok(plotted.y < CENTER_Y, '中心より上にある');
  });

  it('真東の駅は中心の真右に出る', () => {
    const result = renderStationMap({
      width: WIDTH,
      height: HEIGHT,
      origin: DAIMON,
      stations: [station('east', DAIMON.lat, east(500))],
    });

    const plotted = result.plotted[0]!;
    assert.ok(Math.abs(plotted.y - CENTER_Y) < 1, `真右のはずが y=${plotted.y}`);
    assert.ok(plotted.x > CENTER_X, '中心より右にある');
  });

  it('近い駅どうしが潰れない（線形だと潰れた）', () => {
    // 実際に踏んだ問題。69m と 103m の駅が 1km の駅と同居すると、
    // 線形の縮尺では 14m/画素になり、2 駅が 2 画素差になって団子になる。
    const stations = [
      station('near1', north(69), DAIMON.lng),
      station('near2', DAIMON.lat, east(103)),
      station('far', north(1000), east(300)),
    ];

    const result = renderStationMap({
      width: WIDTH,
      height: HEIGHT,
      origin: DAIMON,
      stations,
    });

    const near1 = result.plotted.find((p) => p.station.id === 'near1')!;
    const near2 = result.plotted.find((p) => p.station.id === 'near2')!;
    const gap = Math.hypot(near1.x - near2.x, near1.y - near2.y);

    // 駅の点は半径 2。重ならないには 5 画素は要る。
    assert.ok(gap > 10, `近い 2 駅が ${gap.toFixed(1)} 画素しか離れていない`);
  });

  it('近い順は保たれる（圧縮しても順序は狂わない）', () => {
    const stations = [
      station('c', north(900), DAIMON.lng),
      station('a', north(100), DAIMON.lng),
      station('b', north(400), DAIMON.lng),
    ];

    const result = renderStationMap({
      width: WIDTH,
      height: HEIGHT,
      origin: DAIMON,
      stations,
    });

    const radius = (id: string): number => {
      const p = result.plotted.find((entry) => entry.station.id === id)!;
      return Math.hypot(p.x - CENTER_X, p.y - CENTER_Y);
    };

    assert.ok(radius('a') < radius('b'), 'a が b より内側');
    assert.ok(radius('b') < radius('c'), 'b が c より内側');
  });

  it('全ての駅が画面の中に収まる', () => {
    const stations = [
      station('n', north(1000), DAIMON.lng),
      station('s', north(-1000), DAIMON.lng),
      station('e', DAIMON.lat, east(2000)),
      station('w', DAIMON.lat, east(-2000)),
    ];

    const result = renderStationMap({
      width: WIDTH,
      height: HEIGHT,
      origin: DAIMON,
      stations,
      margin: 8,
    });

    for (const plotted of result.plotted) {
      assert.ok(
        plotted.x >= 0 && plotted.x < WIDTH && plotted.y >= 0 && plotted.y < HEIGHT,
        `${plotted.station.id} が画面外: ${plotted.x.toFixed(0)},${plotted.y.toFixed(0)}`,
      );
    }
  });

  it('選択した駅には輪が付く', () => {
    const result = renderStationMap({
      width: WIDTH,
      height: HEIGHT,
      origin: DAIMON,
      stations: [station('a', north(400), east(400)), station('b', north(-400), DAIMON.lng)],
      selectedId: 'a',
    });

    const selected = result.plotted.find((p) => p.station.id === 'a')!;
    // 中心から半径 6〜7 に輪がある。
    assert.equal(
      result.bitmap.get(Math.round(selected.x) + 6, Math.round(selected.y)),
      LEVEL.bright,
      '輪が乗っている',
    );
  });

  it('いちばん遠い駅までの距離を返す', () => {
    const result = renderStationMap({
      width: WIDTH,
      height: HEIGHT,
      origin: DAIMON,
      stations: [station('a', north(300), DAIMON.lng), station('b', north(1200), DAIMON.lng)],
    });

    assert.ok(Math.abs(result.rangeMeters - 1200) < 20, `range=${result.rangeMeters}`);
  });
});
