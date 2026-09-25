/**
 * 地理院タイルを取って、G2 に送れるビットマップにするまで（ブラウザ側）。
 *
 * 減色そのものは src/core/tileink.ts が持っている。ここがやるのは
 * **canvas を使った取得とデコードだけ**。PNG デコーダを自前で書く必要は
 * ないし、書いてはいけない（手元の検証と実機で結果が変わる）。
 *
 * 地理院タイルは `access-control-allow-origin: *` を返すので canvas が
 * 汚染されず、getImageData がそのまま通る（実測で確認済み）。
 */

import { Bitmap } from '../../src/core/bitmap.js';
import { tileToInk } from '../../src/core/tileink.js';
import {
  gsiTileUrl,
  TILE_SIZE,
  tileWindow,
  toWindowPixel,
  type TileWindow,
} from '../../src/core/mercator.js';
import type { LatLng } from '../../src/core/geo.js';

export interface MapBitmapResult {
  bitmap: Bitmap;
  window: TileWindow;
  /** タイルの取得とデコードにかかった時間（ミリ秒）。 */
  fetchMs: number;
  /** 反転・レベル補正・膨張にかかった時間。 */
  inkMs: number;
  /** 取得できなかったタイルの枚数（海上など 404 が返る）。 */
  missing: number;
}

async function loadTile(url: string): Promise<ImageBitmap | null> {
  try {
    const response = await fetch(url, { mode: 'cors' });
    if (!response.ok) return null;
    return await createImageBitmap(await response.blob());
  } catch {
    // 圏外や DNS 失敗。呼び出し側が「地図なし」で続けられるように null を返す。
    return null;
  }
}

/**
 * 中心を指定して、288x144 の地図ビットマップを作る。
 *
 * 取得できなかったタイルは白（＝紙）のまま残す。反転後は透明になるので、
 * 海上では「何も描かれていない」状態になる。
 */
export async function fetchMapBitmap(
  center: LatLng,
  zoom: number,
  width: number,
  height: number,
  options: { style?: string; basemapMaxLevel?: number } = {},
): Promise<MapBitmapResult> {
  const { style = 'pale', basemapMaxLevel = 7 } = options;
  const window = tileWindow(center, zoom, width, height);

  const canvas = document.createElement('canvas');
  canvas.width = window.columns * TILE_SIZE;
  canvas.height = window.rows * TILE_SIZE;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('2d context unavailable');

  // 取得できなかったところが黒のままだと、反転後に真っ白に光る。
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);

  const startFetch = performance.now();
  const images = await Promise.all(window.tiles.map((tile) => loadTile(gsiTileUrl(tile, style))));

  let missing = 0;
  images.forEach((image, index) => {
    if (!image) {
      missing += 1;
      return;
    }
    const column = index % window.columns;
    const row = Math.floor(index / window.columns);
    context.drawImage(image, column * TILE_SIZE, row * TILE_SIZE);
    image.close();
  });
  const fetchMs = performance.now() - startFetch;

  const startInk = performance.now();
  const imageData = context.getImageData(window.offsetX, window.offsetY, width, height);
  const ink = tileToInk(imageData.data, width, height);
  const bitmap = Bitmap.fromGray8(ink, width, height, basemapMaxLevel);
  const inkMs = performance.now() - startInk;

  return { bitmap, window, fetchMs, inkMs, missing };
}

export { toWindowPixel };
