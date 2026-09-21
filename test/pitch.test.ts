import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { PeekDetector, pitchDegrees } from '../src/core/pitch.js';

describe('ピッチ角の算出', () => {
  it('水平は 0 度', () => {
    assert.equal(pitchDegrees(0), 0);
  });

  it('真上・真下は ±90 度', () => {
    assert.equal(Math.round(pitchDegrees(1)), 90);
    assert.equal(Math.round(pitchDegrees(-1)), -90);
  });

  it('実測の振れ幅 x=±0.8 は約 ±53 度', () => {
    assert.equal(Math.round(pitchDegrees(0.8)), 53);
    assert.equal(Math.round(pitchDegrees(-0.8)), -53);
  });

  it('1G を超える入力でも NaN にしない（加速で瞬間的に超えうる）', () => {
    assert.equal(Math.round(pitchDegrees(1.4)), 90);
    assert.equal(Math.round(pitchDegrees(-1.4)), -90);
  });
});

describe('見上げ判定', () => {
  it('既定では見えている側から始める', () => {
    // 伏せた側から始めると、IMU の最初のサンプルが届くまで何も表示されない。
    // 実機で「グラスに何も出ない」状態になったのでこちらを既定にした。
    assert.equal(new PeekDetector().isUp, true);
  });

  it('見えている状態から下を向くと消える', () => {
    const detector = new PeekDetector({ enterDegrees: 20, exitDegrees: 12 });
    assert.equal(detector.isUp, true);
    assert.equal(detector.update(0), true); // 正面は exit を下回る
    assert.equal(detector.isUp, false);
    assert.equal(detector.update(25), true);
    assert.equal(detector.isUp, true);
  });

  it('閾値を超えたら見上げ扱いにする', () => {
    const detector = new PeekDetector({ enterDegrees: 20, exitDegrees: 12, initiallyUp: false });
    assert.equal(detector.isUp, false);
    assert.equal(detector.update(25), true);
    assert.equal(detector.isUp, true);
  });

  it('ヒステリシスの内側では状態を変えない', () => {
    const detector = new PeekDetector({ enterDegrees: 20, exitDegrees: 12, initiallyUp: false });
    detector.update(25); // up
    assert.equal(detector.update(15), false); // 20 未満だが 12 以上なので維持
    assert.equal(detector.isUp, true);
    assert.equal(detector.update(10), true); // 12 を下回って初めて解除
    assert.equal(detector.isUp, false);
  });

  it('閾値付近で揺れても状態がばたつかない', () => {
    const detector = new PeekDetector({ enterDegrees: 20, exitDegrees: 12, initiallyUp: false });
    let changes = 0;
    for (const value of [19, 21, 19, 21, 18, 19, 21]) {
      if (detector.update(value)) changes += 1;
    }
    assert.equal(changes, 1); // 最初に上がったきり
  });

  it('うつむきには反応しない（見上げると + になると実機で確認済み）', () => {
    const detector = new PeekDetector({ enterDegrees: 20, exitDegrees: 12, initiallyUp: false });
    assert.equal(detector.update(-25), false);
    assert.equal(detector.isUp, false);
    assert.equal(detector.update(-60), false);
    assert.equal(detector.isUp, false);
  });

  it('見上げた状態からうつむきに転じたら解除する', () => {
    const detector = new PeekDetector({ enterDegrees: 20, exitDegrees: 12, initiallyUp: false });
    detector.update(30);
    assert.equal(detector.isUp, true);
    assert.equal(detector.update(-30), true);
    assert.equal(detector.isUp, false);
  });
});
