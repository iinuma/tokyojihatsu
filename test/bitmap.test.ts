import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { Bitmap, LEVEL } from '../src/core/bitmap.js';

describe('Bitmap', () => {
  it('範囲外の描画は黙って捨てる（地図は範囲外の点を描こうとする）', () => {
    const bitmap = new Bitmap(10, 10);
    assert.doesNotThrow(() => {
      bitmap.set(-5, -5, LEVEL.bright);
      bitmap.set(100, 100, LEVEL.bright);
    });
    assert.equal(bitmap.get(0, 0), 0);
  });

  it('階調は 0〜15 に丸める', () => {
    const bitmap = new Bitmap(4, 4);
    bitmap.set(0, 0, 99);
    bitmap.set(1, 0, -5);
    assert.equal(bitmap.get(0, 0), 15);
    assert.equal(bitmap.get(1, 0), 0);
  });

  it('端点が同じ線でも 1 画素は打つ', () => {
    const bitmap = new Bitmap(4, 4);
    bitmap.line(2, 2, 2, 2, LEVEL.bright);
    assert.equal(bitmap.get(2, 2), 15);
  });

  it('Gray8 は 1 画素 1 バイトで、15 が 255 になる', () => {
    const bitmap = new Bitmap(2, 1);
    bitmap.set(0, 0, 15);
    const gray8 = bitmap.toGray8();
    assert.equal(gray8.length, 2);
    assert.equal(gray8[0], 255);
    assert.equal(gray8[1], 0);
  });

  it('Gray4 は 2 画素 1 バイトで、左が上位ニブル', () => {
    const bitmap = new Bitmap(2, 1);
    bitmap.set(0, 0, 0x0f);
    bitmap.set(1, 0, 0x03);
    const packed = bitmap.toGray4Packed();
    assert.equal(packed.length, 1);
    assert.equal(packed[0], 0xf3);
  });

  it('幅が奇数のときは行ごとに byte 境界へ揃える', () => {
    // 揃えないと 1 行ごとに半バイトずれて、画像が斜めに流れる。
    const bitmap = new Bitmap(3, 2);
    const packed = bitmap.toGray4Packed();
    assert.equal(packed.length, 2 * 2, '1 行 2 バイト × 2 行');
  });

  it('288x144 の生バイト数は Gray8 で 41472、Gray4 で 20736', () => {
    const bitmap = new Bitmap(288, 144);
    assert.equal(bitmap.toGray8().length, 41472);
    assert.equal(bitmap.toGray4Packed().length, 20736);
  });

  it('fromGray8 は 8bit グレーを 16 階調に落とす', () => {
    // 実機では canvas の getImageData がこの形で取れる。
    const gray = new Uint8Array([0, 255, 128]);
    const bitmap = Bitmap.fromGray8(gray, 3, 1);
    assert.equal(bitmap.get(0, 0), 0);
    assert.equal(bitmap.get(1, 0), 15);
    assert.equal(bitmap.get(2, 0), 8);
  });

  it('fromGray8 の maxLevel で下敷きとして暗くできる', () => {
    // 地図を下敷きにして、その上へ印を最大の明るさで乗せるため。
    const gray = new Uint8Array([255, 255]);
    const bitmap = Bitmap.fromGray8(gray, 2, 1, 7);
    assert.equal(bitmap.get(0, 0), 7, '最大でも 7 に収まる');
  });

  it('fromGray8 は画素が足りなければ落とす', () => {
    assert.throws(() => Bitmap.fromGray8(new Uint8Array(5), 10, 10), /too short/);
  });

  it('ring は輪郭だけで、中心は塗らない', () => {
    const bitmap = new Bitmap(21, 21);
    bitmap.ring(10, 10, 5, LEVEL.bright);
    assert.equal(bitmap.get(10, 10), 0, '中心は空いている');
    assert.equal(bitmap.get(15, 10), 15, '右端は乗っている');
  });

  it('get は set と同じく座標を丸める', () => {
    // 片方だけ丸めると、中心が 143.5 のような小数のとき
    // 「描いたのに読めない」食い違いが起きる。
    const bitmap = new Bitmap(10, 10);
    bitmap.set(5, 5, LEVEL.bright);
    assert.equal(bitmap.get(4.6, 5.4), 15);
  });

  it('disc は中心を塗る', () => {
    const bitmap = new Bitmap(21, 21);
    bitmap.disc(10, 10, 3, LEVEL.mid);
    assert.equal(bitmap.get(10, 10), LEVEL.mid);
  });
});
