/**
 * 地理院タイルを下敷きにした地図を、実機に入れる前に手元で見る。
 *
 * **減色と重ね合わせは src/core の実装をそのまま呼ぶ**。ここで別の処理を
 * 書くと、手元で見たものと実機に出るものが違ってしまう。ImageMagick は
 * タイルの連結・切り出しと、結果を PNG にする表示のためだけに使う
 * （実機ではどちらも canvas が受け持つ）。
 *
 * データ元は国土地理院の地理院タイル。地理院サーバーからリアルタイムに
 * 読み込んで表示する限り、申請不要・出典の明示のみで使える。
 *
 *   npx tsx scripts/preview-tilemap.ts 35.5376 139.7420
 */

import { execFileSync } from 'node:child_process';
import { deflateSync } from 'node:zlib';
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

import { Bitmap, LEVEL, MAX_IMAGE_WIDTH, MAX_IMAGE_HEIGHT } from '../src/core/bitmap.js';
import { nearest, type LatLng } from '../src/core/geo.js';
import { groupStations, usableStations, type StationMaster } from '../src/core/master.js';
import {
  GSI_ATTRIBUTION,
  gsiTileUrl,
  metersPerPixel,
  tileWindow,
  toWindowPixel,
  TILE_SIZE,
  type TileWindow,
} from '../src/core/mercator.js';
import { tileToInk } from '../src/core/tileink.js';

const ROOT = resolve(import.meta.dirname, '..');
const OUT_DIR = resolve(ROOT, 'dist/preview');
const WORK = resolve(OUT_DIR, '.tiles');

const WIDTH = MAX_IMAGE_WIDTH;
const HEIGHT = MAX_IMAGE_HEIGHT;

/** z13 で約 15.5 m/画素。288px に約 4.5km 入り、徒歩圏 2km 半径と合う。 */
const ZOOM = 13;
const STYLE = 'pale';

/** 地図は下敷きなので暗くする。印を最大 15 で乗せたとき埋もれないように。 */
const BASEMAP_MAX_LEVEL = 7;

/** タイルを取得して連結し、窓を切り出して RGBA で返す。実機では canvas の仕事。 */
async function fetchWindowRgba(window: TileWindow): Promise<Uint8ClampedArray> {
  rmSync(WORK, { recursive: true, force: true });
  mkdirSync(WORK, { recursive: true });

  const files: string[] = [];
  for (const tile of window.tiles) {
    const file = resolve(WORK, `t-${tile.x}-${tile.y}.png`);
    const response = await fetch(gsiTileUrl(tile, STYLE));
    if (response.ok) {
      writeFileSync(file, Buffer.from(await response.arrayBuffer()));
    } else {
      // 海上や範囲外は 404 が返る。白（＝紙）で埋めれば、反転後に透明になる。
      execFileSync('magick', ['-size', `${TILE_SIZE}x${TILE_SIZE}`, 'xc:white', file]);
    }
    files.push(file);
  }

  // tiles は行優先で並んでいるので、columns ごとに横へ繋いでから縦に積む。
  const rowFiles: string[] = [];
  for (let row = 0; row < window.rows; row += 1) {
    const cols = files.slice(row * window.columns, (row + 1) * window.columns);
    const rowFile = resolve(WORK, `row-${row}.png`);
    execFileSync('magick', [...cols, '+append', rowFile]);
    rowFiles.push(rowFile);
  }

  const rgbaFile = resolve(WORK, 'win.rgba');
  execFileSync('magick', [
    ...rowFiles,
    '-append',
    '-crop', `${WIDTH}x${HEIGHT}+${window.offsetX}+${window.offsetY}`,
    '+repage',
    '-depth', '8',
    `rgba:${rgbaFile}`,
  ]);

  return new Uint8ClampedArray(readFileSync(rgbaFile));
}

function writePng(bitmap: Bitmap, path: string, zoom: number): void {
  const raw = resolve(WORK, 'out.gray');
  writeFileSync(raw, Buffer.from(bitmap.toGray8()));
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
  const near = nearest(origin, groupStations(usableStations(master)), {
    limit: 12,
    maxDistanceMeters: 2000,
  });

  const window = tileWindow(origin, ZOOM, WIDTH, HEIGHT);
  console.log(`\n  地理院タイル ${STYLE} z${ZOOM} を ${window.tiles.length} 枚取得中…`);

  const rgba = await fetchWindowRgba(window);
  const ink = tileToInk(rgba, WIDTH, HEIGHT);
  const bitmap = Bitmap.fromGray8(ink, WIDTH, HEIGHT, BASEMAP_MAX_LEVEL);

  // 下敷きの上に印を重ねる。地図があるので半径は圧縮しない
  // （圧縮すると印と地図がずれ、地図である意味が消える）。
  for (const { item } of near) {
    const at = toWindowPixel(item, window);
    bitmap.disc(at.x, at.y, 2, LEVEL.bright);
    bitmap.ring(at.x, at.y, 4, LEVEL.mid);
  }

  const selected = near[0];
  if (selected) {
    const at = toWindowPixel(selected.item, window);
    bitmap.ring(at.x, at.y, 7, LEVEL.bright);
    bitmap.ring(at.x, at.y, 8, LEVEL.bright);
  }

  const here = toWindowPixel(origin, window);
  bitmap.cross(here.x, here.y, 8, LEVEL.bright);
  bitmap.set(here.x, here.y, LEVEL.off);

  mkdirSync(OUT_DIR, { recursive: true });
  writePng(bitmap, resolve(OUT_DIR, 'tilemap-x1.png'), 1);
  writePng(bitmap, resolve(OUT_DIR, 'tilemap-x3.png'), 3);

  const packed = bitmap.toGray4Packed();
  const compressed = deflateSync(packed, { level: 9 }).length;
  const scale = metersPerPixel(origin.lat, ZOOM);

  console.log(`  Gray4 ${packed.length} → deflate ${compressed} bytes (${(packed.length / compressed).toFixed(1)}:1)`);
  console.log(`\n  縮尺 ${scale.toFixed(1)} m/画素  範囲 ${((WIDTH * scale) / 1000).toFixed(1)}km × ${((HEIGHT * scale) / 1000).toFixed(1)}km`);
  console.log(`  近傍 ${near.length} 駅: ${near.slice(0, 5).map((n) => n.item.name).join('・')}…`);
  console.log(`\n  ${GSI_ATTRIBUTION}`);
  console.log(`  → ${OUT_DIR}/tilemap-x1.png / -x3.png\n`);
}

main();
