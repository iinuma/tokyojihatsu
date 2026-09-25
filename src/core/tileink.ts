/**
 * 地図タイルを、透過ディスプレイで読める形に落とす。
 *
 * **紙の地図をそのまま出すと消える。** 紙は白地に黒インクだが、G2 は
 * 明るい＝光る・暗い＝透明なので、そのままだとインクが透明になって
 * 紙だけが光る。必ず反転する。
 *
 * 反転したあとも、そのままでは建物の塗りが一面に残って視界を塞ぐ。
 * レベル補正で薄い塗りを切り落とし、残った線（道路・鉄道・水域の境界）だけを
 * 太らせる。ImageMagick でいう `-negate -level 10%,45% -morphology Dilate Diamond:1`
 * と同じことを、実機の canvas から取れる RGBA に対して行う。
 *
 * 手元での検証は scripts/preview-tilemap.ts（ImageMagick 版）で行い、
 * ここは同じ結果になるように書いてある。
 */

/** レベル補正の下限・上限（0〜1）。ここより暗い側は黒に潰す。 */
const LEVEL_BLACK = 0.10;
const LEVEL_WHITE = 0.45;

/**
 * RGBA の画素列を、反転・レベル補正・膨張して 8bit グレーにする。
 *
 * @param rgba canvas の getImageData().data と同じ並び（4 バイト/画素）
 */
export function tileToInk(rgba: Uint8ClampedArray | Uint8Array, width: number, height: number): Uint8Array {
  const count = width * height;
  if (rgba.length < count * 4) {
    throw new Error(`rgba too short: ${rgba.length} < ${count * 4}`);
  }

  const leveled = new Uint8Array(count);
  const black = LEVEL_BLACK * 255;
  const span = (LEVEL_WHITE - LEVEL_BLACK) * 255;

  for (let i = 0; i < count; i += 1) {
    const r = rgba[i * 4] ?? 0;
    const g = rgba[i * 4 + 1] ?? 0;
    const b = rgba[i * 4 + 2] ?? 0;

    // Rec.709 の輝度。ImageMagick の -colorspace Gray と同じ重み。
    const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;

    // 反転してからレベル補正。
    const inverted = 255 - luminance;
    const scaled = ((inverted - black) / span) * 255;
    leveled[i] = scaled < 0 ? 0 : scaled > 255 ? 255 : Math.round(scaled);
  }

  return dilateDiamond(leveled, width, height);
}

/**
 * 上下左右と自分のうち最大を採る（Diamond:1 の膨張）。
 *
 * 等倍 288x144 では線が 1 画素だと視認できないので太らせる。
 * 太らせすぎると塗りに戻ってしまうので半径 1 まで。
 */
export function dilateDiamond(gray: Uint8Array, width: number, height: number): Uint8Array {
  const out = new Uint8Array(gray.length);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      let max = gray[index] ?? 0;

      if (x > 0) max = Math.max(max, gray[index - 1] ?? 0);
      if (x < width - 1) max = Math.max(max, gray[index + 1] ?? 0);
      if (y > 0) max = Math.max(max, gray[index - width] ?? 0);
      if (y < height - 1) max = Math.max(max, gray[index + width] ?? 0);

      out[index] = max;
    }
  }

  return out;
}
