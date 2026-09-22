import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { isChallengeUsable, usableStations } from '../src/core/master.js';
import type { MasterStation, StationMaster } from '../src/core/master.js';

function station(id: string, license: 'basic' | 'challenge'): MasterStation {
  return {
    id,
    name: id,
    lat: 35.6,
    lng: 139.7,
    operator: 'odpt.Operator:X',
    operatorName: 'X',
    railway: 'odpt.Railway:X.Y',
    railwayName: 'Y',
    license,
    directions: [],
  };
}

const master: StationMaster = {
  generatedAt: '2026-09-23T00:00:00Z',
  sourceDate: '2026-07-17',
  challengeExpiresAt: '2027-03-12',
  stationCount: 2,
  stations: [station('basic-1', 'basic'), station('challenge-1', 'challenge')],
  labels: {},
};

describe('チャレンジ限定データの期限', () => {
  it('期限前は使える', () => {
    assert.equal(isChallengeUsable(master, new Date('2027-01-01T00:00:00+09:00')), true);
  });

  it('期限当日は使える', () => {
    // 許諾は 2027-03-12 に終了。当日いっぱいは使える扱いにする
    assert.equal(isChallengeUsable(master, new Date('2027-03-12T23:59:00+09:00')), true);
  });

  it('翌日は使えない', () => {
    assert.equal(isChallengeUsable(master, new Date('2027-03-13T00:01:00+09:00')), false);
  });

  it('期限がなければ最初から使えない', () => {
    const withoutExpiry = { ...master, challengeExpiresAt: undefined };
    assert.equal(isChallengeUsable(withoutExpiry, new Date('2026-09-23')), false);
  });
});

describe('期限後の駅の扱い', () => {
  it('期限前は両方の駅を出す', () => {
    const list = usableStations(master, new Date('2027-01-01T00:00:00+09:00'));
    assert.equal(list.length, 2);
  });

  it('期限後は基本ライセンスの駅だけに戻る', () => {
    // アプリは壊れず、対応範囲が狭まるだけになる
    const list = usableStations(master, new Date('2027-03-13T00:01:00+09:00'));
    assert.deepEqual(list.map((s) => s.id), ['basic-1']);
  });
});
