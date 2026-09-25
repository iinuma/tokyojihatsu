/**
 * 駅の模式図を PNG に書き出して、実機に持って行く前に手元で見る。
 *
 * 地図の描画は純粋な計算（緯度経度 → 画素）なので、G2 が無くても検証できる。
 * レンタル期間中の実機の時間は、手元で確かめられないこと——転送時間と、
 * 透過ディスプレイでの実際の見え方——だけに使いたい。
 *
 *   npx tsx scripts/preview-map.ts                    # 大門
 *   npx tsx scripts/preview-map.ts 35.5376 139.7476   # 大師橋
 */

import { deflateSync } from 'node:zlib';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

import { renderStationMap, type MapStation } from '../src/core/stationmap.js';
import { nearest } from '../src/core/geo.js';
import { groupStations, usableStations, type StationMaster } from '../src/core/master.js';
import { MAX_IMAGE_WIDTH, MAX_IMAGE_HEIGHT, type Bitmap } from '../src/core/bitmap.js';

const ROOT = resolve(import.meta.dirname, '..');
const OUT_DIR = resolve(ROOT, 'dist/preview');

/** 見やすさのための拡大率。実機は等倍。 */
const ZOOM = 3;

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer: Uint8Array): number {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

/**
 * G2 の見え方に寄せた PNG。黒地に緑で、階調は 0〜15 をそのまま明るさにする。
 * 実機は透過なので黒は「透明」だが、紙の上で見るには黒のほうが分かりやすい。
 */
function writePng(bitmap: Bitmap, path: string, zoom: number): number {
  const width = bitmap.width * zoom;
  const height = bitmap.height * zoom;

  const raw = Buffer.alloc(height * (1 + width * 3));
  let offset = 0;
  for (let y = 0; y < height; y += 1) {
    raw[offset] = 0; // フィルタ種別 None
    offset += 1;
    for (let x = 0; x < width; x += 1) {
      const level = bitmap.get(Math.floor(x / zoom), Math.floor(y / zoom));
      // Even Realities の緑に寄せる。赤は乗せない。
      raw[offset] = Math.round(level * 2);
      raw[offset + 1] = level * 17;
      raw[offset + 2] = Math.round(level * 6);
      offset += 3;
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', new Uint8Array(0)),
  ]);

  writeFileSync(path, png);
  return png.length;
}

function main(): void {
  const lat = Number(process.argv[2] ?? 35.65742);
  const lng = Number(process.argv[3] ?? 139.75503);
  const origin = { lat, lng };

  const master: StationMaster = JSON.parse(
    readFileSync(resolve(ROOT, 'data/stations.json'), 'utf8'),
  );

  // 同名・近接のホームはまとめる。まとめないと浜松町の山手線と京浜東北線が
  // 同じ座標に 2 点描かれて団子になる（実際になった）。
  const groups = groupStations(usableStations(master));
  const near = nearest(origin, groups, { limit: 12, maxDistanceMeters: 2000 });
  if (near.length === 0) {
    console.error(`2km 以内に駅がありません: ${lat}, ${lng}`);
    process.exit(1);
  }

  const stations: MapStation[] = near.map(({ item }) => ({
    id: item.name,
    name: item.name,
    lat: item.lat,
    lng: item.lng,
  }));

  const selectedId = stations[0]!.id;
  const result = renderStationMap({
    width: MAX_IMAGE_WIDTH,
    height: MAX_IMAGE_HEIGHT,
    origin,
    stations,
    selectedId,
  });

  mkdirSync(OUT_DIR, { recursive: true });
  const path = resolve(OUT_DIR, `map-${lat.toFixed(4)}_${lng.toFixed(4)}.png`);
  const pngBytes = writePng(result.bitmap, path, ZOOM);

  const gray8 = result.bitmap.toGray8().length;
  const gray4 = result.bitmap.toGray4Packed().length;

  console.log(`\n  ${lat}, ${lng} の周辺 ${near.length} 駅\n`);
  for (const { item, distanceMeters } of near) {
    const mark = item.name === selectedId ? '●' : ' ';
    const railways = item.entries.map((entry) => entry.railwayName).join('・');
    console.log(
      `  ${mark} ${item.name.padEnd(8, '　')} ${String(Math.round(distanceMeters)).padStart(5)}m  ${railways}`,
    );
  }
  console.log(`\n  範囲        中心から ${Math.round(result.rangeMeters)}m（半径は平方根で圧縮）`);
  console.log(`  画像サイズ  ${MAX_IMAGE_WIDTH}x${MAX_IMAGE_HEIGHT}`);
  console.log(`  Gray8       ${gray8.toLocaleString()} bytes`);
  console.log(`  Gray4       ${gray4.toLocaleString()} bytes（この半分が実際の送信量の上限）`);
  console.log(`  LZ4 前の圧縮見込み: deflate で ${deflateSync(result.bitmap.toGray4Packed(), { level: 9 }).length.toLocaleString()} bytes`);
  console.log(`\n  → ${path}  (${(pngBytes / 1024).toFixed(1)} KB, ${ZOOM}倍)\n`);
}

main();
