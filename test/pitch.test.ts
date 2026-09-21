import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { PeekDetector, pitchDegrees } from '../probe/src/pitch.js';

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
  it('閾値を超えたら見上げ扱いにする', () => {
    const detector = new PeekDetector({ enterDegrees: 20, exitDegrees: 12 });
    assert.equal(detector.isUp, false);
    assert.equal(detector.update(25), true);
    assert.equal(detector.isUp, true);
  });

  it('ヒステリシスの内側では状態を変えない', () => {
    const detector = new PeekDetector({ enterDegrees: 20, exitDegrees: 12 });
    detector.update(25); // up
    assert.equal(detector.update(15), false); // 20 未満だが 12 以上なので維持
    assert.equal(detector.isUp, true);
    assert.equal(detector.update(10), true); // 12 を下回って初めて解除
    assert.equal(detector.isUp, false);
  });

  it('閾値付近で揺れても状態がばたつかない', () => {
    const detector = new PeekDetector({ enterDegrees: 20, exitDegrees: 12 });
    let changes = 0;
    for (const value of [19, 21, 19, 21, 18, 19, 21]) {
      if (detector.update(value)) changes += 1;
    }
    assert.equal(changes, 1); // 最初に上がったきり
  });

  it('見下ろしも見上げとして扱う（符号の向きが未確定なため絶対値で判定）', () => {
    const detector = new PeekDetector({ enterDegrees: 20, exitDegrees: 12 });
    assert.equal(detector.update(-25), true);
    assert.equal(detector.isUp, true);
  });
});
