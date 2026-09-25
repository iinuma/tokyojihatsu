import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { tileToInk, dilateDiamond } from '../src/core/tileink.js';

/** w x h の RGBA を、各画素のグレー値から組み立てる。 */
function rgba(values: number[]): Uint8ClampedArray {
  const out = new Uint8ClampedArray(values.length * 4);
  values.forEach((value, i) => {
    out[i * 4] = value;
    out[i * 4 + 1] = value;
    out[i * 4 + 2] = value;
    out[i * 4 + 3] = 255;
  });
  return out;
}

describe('tileToInk', () => {
  it('白い紙は透明（0）になる', () => {
    // ここを間違えると、地図の紙が光って視界を塞ぐ。
    const ink = tileToInk(rgba([255]), 1, 1);
    assert.equal(ink[0], 0);
  });

  it('黒いインクは明るく（255）なる', () => {
    const ink = tileToInk(rgba([0]), 1, 1);
    assert.equal(ink[0], 255);
  });

  it('薄い塗りは切り落とす', () => {
    // 建物の淡い塗り（240 程度）が残ると一面が光る。
    const ink = tileToInk(rgba([240]), 1, 1);
    assert.equal(ink[0], 0, '淡い塗りは消える');
  });

  it('中間の線は残る', () => {
    const ink = tileToInk(rgba([160]), 1, 1);
    assert.ok(ink[0]! > 0, '道路の線は残る');
  });

  it('画素が足りなければ落とす', () => {
    assert.throws(() => tileToInk(new Uint8ClampedArray(4), 10, 10), /too short/);
  });

  it('緑は赤より明るく扱われる（Rec.709）', () => {
    const green = new Uint8ClampedArray([0, 255, 0, 255]);
    const red = new Uint8ClampedArray([255, 0, 0, 255]);
    // 輝度が高い＝紙に近い＝反転後は暗い。
    assert.ok(tileToInk(green, 1, 1)[0]! < tileToInk(red, 1, 1)[0]!);
  });
});

describe('dilateDiamond', () => {
  it('1 画素の点が上下左右へ広がる', () => {
    const gray = new Uint8Array(9);
    gray[4] = 200; // 中心
    const out = dilateDiamond(gray, 3, 3);

    assert.equal(out[4], 200, '中心');
    assert.equal(out[1], 200, '上');
    assert.equal(out[7], 200, '下');
    assert.equal(out[3], 200, '左');
    assert.equal(out[5], 200, '右');
    assert.equal(out[0], 0, '斜めは広がらない');
  });

  it('縁でも配列外を読まない', () => {
    const gray = new Uint8Array([9, 9, 9, 9]);
    assert.doesNotThrow(() => dilateDiamond(gray, 2, 2));
  });
});
