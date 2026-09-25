/**
 * 地理院タイルを下敷きにした地図を試す。模式図との比較用。
 *
 * データ元は国土地理院の地理院タイル。リアルタイムに読み込んで表示する限り
 * **申請不要・出典の明示のみ**で使える（加工する場合はその旨も明記する）。
 * 鍵も要らず、日本全国が揃っているので、このアプリの対応範囲とちょうど合う。
 *
 *   https://maps.gsi.go.jp/development/ichiran.html
 *
 * 実機では、タイルの取得と減色は WebView の canvas でできる（getImageData が
 * 8bit グレーで取れる）。PNG デコーダを自前で持つ必要はない。
 * ここでは手元で見るために ImageMagick を使っている。
 *
 *   npx tsx scripts/preview-tilemap.ts 35.5376 139.7420
 */

import { execFileSync } from 'node:child_process';
import { deflateSync } from 'node:zlib';
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

import { Bitmap, LEVEL, MAX_IMAGE_WIDTH, MAX_IMAGE_HEIGHT } from '../src/core/bitmap.js';
import { nearest, distanceMeters, type LatLng } from '../src/core/geo.js';
import { groupStations, usableStations, type StationMaster } from '../src/core/master.js';

const ROOT = resolve(import.meta.dirname, '..');
const OUT_DIR = resolve(ROOT, 'dist/preview');
const WORK = resolve(ROOT, 'dist/preview/.tiles');

const TILE = 256;
const WIDTH = MAX_IMAGE_WIDTH;
const HEIGHT = MAX_IMAGE_HEIGHT;

/** z13 で約 15.5 m/画素。288px に約 4.5km 入り、徒歩圏の 2km 半径とちょうど合う。 */
const ZOOM = 13;
const STYLE = 'pale';

/** 地図は下敷きなので暗くする。印を最大 15 で乗せたとき埋もれないように。 */
const BASEMAP_MAX_LEVEL = 7;

interface Window {
  originPx: number;
  originPy: number;
  left: number;
  top: number;
}

function pixelXY(point: LatLng, zoom: number): { px: number; py: number } {
  const n = 2 ** zoom * TILE;
  const latRad = (point.lat * Math.PI) / 180;
  return {
    px: ((point.lng + 180) / 360) * n,
    py: ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n,
  };
}

async function fetchWindow(origin: LatLng, zoom: number): Promise<Window> {
  const { px, py } = pixelXY(origin, zoom);
  const left = px - WIDTH / 2;
  const top = py - HEIGHT / 2;

  const tx0 = Math.floor(left / TILE);
  const ty0 = Math.floor(top / TILE);
  const tx1 = Math.floor((left + WIDTH) / TILE);
  const ty1 = Math.floor((top + HEIGHT) / TILE);

  rmSync(WORK, { recursive: true, force: true });
  mkdirSync(WORK, { recursive: true });

  const rowFiles: string[] = [];
  for (let ty = ty0; ty <= ty1; ty += 1) {
    const cols: string[] = [];
    for (let tx = tx0; tx <= tx1; tx += 1) {
      const url = `https://cyberjapandata.gsi.go.jp/xyz/${STYLE}/${zoom}/${tx}/${ty}.png`;
      const response = await fetch(url);
      const file = resolve(WORK, `t-${tx}-${ty}.png`);
      if (response.ok) {
        writeFileSync(file, Buffer.from(await response.arrayBuffer()));
      } else {
        // 海上や範囲外は 404。白タイルで埋める。
        execFileSync('magick', ['-size', `${TILE}x${TILE}`, 'xc:white', file]);
      }
      cols.push(file);
    }
    const rowFile = resolve(WORK, `row-${ty}.png`);
    execFileSync('magick', [...cols, '+append', rowFile]);
    rowFiles.push(rowFile);
  }

  execFileSync('magick', [...rowFiles, '-append', resolve(WORK, 'joined.png')]);
  execFileSync('magick', [
    resolve(WORK, 'joined.png'),
    '-crop',
    `${WIDTH}x${HEIGHT}+${Math.round(left - tx0 * TILE)}+${Math.round(top - ty0 * TILE)}`,
    '+repage',
    resolve(WORK, 'win.png'),
  ]);

  return { originPx: px, originPy: py, left, top };
}

/**
 * 透過ディスプレイ向けの減色。
 *
 * 紙の地図は白地に黒インクだが、G2 は明るい＝光る・暗い＝透明なので、
 * **そのまま出すとインクが消えて紙だけが光る**。必ず反転する。
 */
function toGray(variant: 'edge' | 'ink'): Uint8Array {
  const source = resolve(WORK, 'win.png');
  const out = resolve(WORK, `${variant}.gray`);

  const args =
    variant === 'edge'
      ? [source, '-colorspace', 'Gray',
         '-define', 'convolve:scale=!', '-define', 'morphology:compose=Lighten',
         '-morphology', 'Convolve', 'Sobel:>', '-normalize']
      : [source, '-colorspace', 'Gray', '-negate', '-level', '10%,45%',
         '-morphology', 'Dilate', 'Diamond:1'];

  execFileSync('magick', [...args, '-depth', '8', `gray:${out}`]);
  return new Uint8Array(readFileSync(out));
}

function writePng(bitmap: Bitmap, path: string, zoom: number): void {
  const raw = resolve(WORK, 'out.gray');
  const scaled = bitmap.toGray8();
  writeFileSync(raw, Buffer.from(scaled));
  execFileSync('magick', [
    '-size', `${bitmap.width}x${bitmap.height}`, '-depth', '8', `gray:${raw}`,
    '-fill', '#00ff44', '-tint', '100',
    '-filter', 'point', '-resize', `${zoom * 100}%`,
    path,
  ]);
}

async function main(): Promise<void> {
  const origin: LatLng = {
    lat: Number(process.argv[2] ?? 35.5376),
    lng: Number(process.argv[3] ?? 139.742),
  };

  const master: StationMaster = JSON.parse(
    readFileSync(resolve(ROOT, 'data/stations.json'), 'utf8'),
  );
  const groups = groupStations(usableStations(master));
  const near = nearest(origin, groups, { limit: 12, maxDistanceMeters: 2000 });

  console.log(`\n  地理院タイル（${STYLE} z${ZOOM}）を取得中…`);
  const window = await fetchWindow(origin, ZOOM);

  const metersPerPixel = (156543.03392 * Math.cos((origin.lat * Math.PI) / 180)) / 2 ** ZOOM;
  mkdirSync(OUT_DIR, { recursive: true });

  const toScreen = (point: LatLng): { x: number; y: number } => {
    const { px, py } = pixelXY(point, ZOOM);
    return { x: px - window.left, y: py - window.top };
  };

  for (const variant of ['ink', 'edge'] as const) {
    const gray = toGray(variant);
    const bitmap = Bitmap.fromGray8(gray, WIDTH, HEIGHT, BASEMAP_MAX_LEVEL);

    // 下敷きの上に印を重ねる。地図があるので半径の圧縮はしない
    // （圧縮すると印と地図がずれて、地図である意味が消える）。
    for (const { item } of near) {
      const at = toScreen(item);
      bitmap.disc(at.x, at.y, 2, LEVEL.bright);
      bitmap.ring(at.x, at.y, 4, LEVEL.mid);
    }

    const selected = near[0];
    if (selected) {
      const at = toScreen(selected.item);
      bitmap.ring(at.x, at.y, 7, LEVEL.bright);
      bitmap.ring(at.x, at.y, 8, LEVEL.bright);
    }

    const here = toScreen(origin);
    bitmap.cross(here.x, here.y, 8, LEVEL.bright);
    bitmap.set(here.x, here.y, LEVEL.off);

    const packed = bitmap.toGray4Packed();
    const compressed = deflateSync(packed, { level: 9 }).length;

    writePng(bitmap, resolve(OUT_DIR, `tilemap-${variant}-x1.png`), 1);
    writePng(bitmap, resolve(OUT_DIR, `tilemap-${variant}-x3.png`), 3);

    console.log(
      `  ${variant.padEnd(5)} Gray4 ${packed.length} → deflate ${compressed} bytes ` +
        `(${(packed.length / compressed).toFixed(1)}:1)`,
    );
  }

  console.log(`\n  縮尺 ${metersPerPixel.toFixed(1)} m/画素  範囲 ${(WIDTH * metersPerPixel / 1000).toFixed(1)}km × ${(HEIGHT * metersPerPixel / 1000).toFixed(1)}km`);
  console.log(`  近傍 ${near.length} 駅: ${near.slice(0, 5).map((n) => n.item.name).join('・')}…`);
  console.log(`\n  出典: 国土地理院（地理院タイルを加工して使用）`);
  console.log(`  → ${OUT_DIR}/tilemap-*.png\n`);
}

main();
