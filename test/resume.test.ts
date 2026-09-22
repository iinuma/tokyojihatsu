import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { distanceMeters } from '../src/core/geo.js';
import { groupStations } from '../src/core/master.js';
import type { MasterStation } from '../src/core/master.js';

/**
 * 前回の選択を復元してよいかの判定。
 * アプリ本体（app/src/main.ts の resumeIfPossible）と同じ条件をここで検証する。
 */
function shouldResume(
  here: { lat: number; lng: number },
  saved: { lat: number; lng: number; stationId: string },
  stations: MasterStation[],
  options: { resumeRadius: number; maxExtraMeters: number },
): boolean {
  if (distanceMeters(here, saved) > options.resumeRadius) return false;

  const target = stations.find((s) => s.id === saved.stationId);
  if (!target) return false;

  const nearest = groupStations(stations)
    .map((group) => distanceMeters(here, group))
    .sort((a, b) => a - b)[0];
  if (nearest === undefined) return true;

  return distanceMeters(here, target) - nearest <= options.maxExtraMeters;
}

function station(id: string, name: string, lat: number, lng: number): MasterStation {
  return {
    id,
    name,
    lat,
    lng,
    operator: 'odpt.Operator:X',
    operatorName: 'X',
    railway: 'odpt.Railway:X.Y',
    railwayName: 'Y',
    license: 'basic',
    directions: [],
  };
}

// 実機で問題が出た配置。自宅から大師橋 142m、西馬込 6.4km。
const HOME = { lat: 35.536, lng: 139.73955 };
const DAISHIBASHI = station('daishibashi', '大師橋', 35.5372, 139.7385);
const NISHIMAGOME = station('nishimagome', '西馬込', 35.5852, 139.7107);
const OPTIONS = { resumeRadius: 500, maxExtraMeters: 500 };

describe('前回の選択を復元するか', () => {
  it('近くにもっと良い駅があれば復元しない', () => {
    // 保存しているのは選択時の現在地であって駅の位置ではない。
    // 距離だけで判断すると、同じ場所にいる限り遠い駅が復元され続ける
    const resume = shouldResume(
      HOME,
      { ...HOME, stationId: NISHIMAGOME.id },
      [DAISHIBASHI, NISHIMAGOME],
      OPTIONS,
    );
    assert.equal(resume, false);
  });

  it('その駅が最寄りなら復元する', () => {
    const resume = shouldResume(
      HOME,
      { ...HOME, stationId: DAISHIBASHI.id },
      [DAISHIBASHI, NISHIMAGOME],
      OPTIONS,
    );
    assert.equal(resume, true);
  });

  it('前に選んだ場所から離れていれば復元しない', () => {
    const faraway = { lat: 35.68, lng: 139.76 };
    const resume = shouldResume(
      faraway,
      { ...HOME, stationId: DAISHIBASHI.id },
      [DAISHIBASHI, NISHIMAGOME],
      OPTIONS,
    );
    assert.equal(resume, false);
  });

  it('少しだけ遠い駅なら復元する（乗り換えの都合で隣駅を使うことがある）', () => {
    const nearby = station('near', '近い駅', 35.5365, 139.7397);
    const slightly = station('slightly', 'やや遠い駅', 35.5382, 139.7402);
    const resume = shouldResume(
      HOME,
      { ...HOME, stationId: slightly.id },
      [nearby, slightly],
      OPTIONS,
    );
    assert.equal(resume, true);
  });

  it('候補が 1 駅しかなければ復元する', () => {
    const resume = shouldResume(
      HOME,
      { ...HOME, stationId: NISHIMAGOME.id },
      [NISHIMAGOME],
      OPTIONS,
    );
    assert.equal(resume, true);
  });
});
