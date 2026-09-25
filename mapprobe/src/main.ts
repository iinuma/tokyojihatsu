/**
 * 地図 probe — 実機でしか決まらないことを測る。
 *
 * 手元（scripts/preview-tilemap.ts）で分かったのは、地理院タイルを反転・
 * レベル補正して 288x144 の Gray4 にすると 4,110 バイトまで縮む、ということ。
 * 模式図は 257 バイトなので **16 倍**。ここから先は実機でないと決まらない。
 *
 *   1. その 1 枚を送るのに何ミリ秒かかるか。
 *      → スクロールに追従できるのか、確定後の確認画面にするのかが決まる。
 *   2. Gray8 と Gray4 のどちらが通るか。ニブルの並びは合っているか。
 *      → 仕様が公開されていない。縞に見えたら並びが逆。
 *   3. 屋外で、この明るさの面がどれだけ視界を塞ぐか。
 *      → 川や幹線道路が帯になる。等倍でノイズに見えるかテクスチャに見えるか。
 *
 * 右半分の上に実地図、下に模式図を同時に出すので、**同じ場所を同じ画面で
 * 見比べられる**。
 *
 * 出典: 国土地理院（地理院タイルを加工して使用）
 * https://maps.gsi.go.jp/development/ichiran.html
 */

import {
  AppLocationAccuracy,
  CreateStartUpPageContainer,
  EvenAppBridge,
  ImageContainerProperty,
  ImageRawDataUpdate,
  ImageRawDataUpdateResult,
  MenuContainerProperty,
  MenuItemProperty,
  OsEventTypeList,
  StartUpPageCreateResult,
  TextContainerProperty,
  TextContainerUpgrade,
  waitForEvenAppBridge,
  type EvenHubEvent,
} from '@evenrealities/even_hub_sdk';

import masterData from '../../data/stations.json' with { type: 'json' };

import { Bitmap, LEVEL, MAX_IMAGE_HEIGHT, MAX_IMAGE_WIDTH } from '../../src/core/bitmap.js';
import { nearest, type LatLng } from '../../src/core/geo.js';
import { groupStations, usableStations, type StationGroup, type StationMaster } from '../../src/core/master.js';
import { metersPerPixel, toWindowPixel } from '../../src/core/mercator.js';
import { renderStationMap, type MapStation } from '../../src/core/stationmap.js';
import { isClick, isDoubleClick, isScrollDown, isScrollUp } from '../../app/src/events.js';
import { fetchMapBitmap } from './tiles.js';

const master = masterData as unknown as StationMaster;

const TEXT = { id: 1, name: 'status', x: 0, y: 0, width: 288, height: 288 };
const MAP = { id: 2, name: 'map', x: 288, y: 0, width: MAX_IMAGE_WIDTH, height: MAX_IMAGE_HEIGHT };
const SCHEMA = { id: 3, name: 'schema', x: 288, y: 144, width: MAX_IMAGE_WIDTH, height: MAX_IMAGE_HEIGHT };

const MENU_FORMAT = 1;
const MENU_RERUN = 2;
const MENU_EXIT = 3;

/** ズームは実機で切り替えて、どの縮尺が読めるか判断する。 */
const ZOOMS = [12, 13, 14, 15] as const;

type Format = 'gray4' | 'gray8';

interface Timing {
  label: string;
  bytes: number;
  samples: number[];
  lastResult: string;
}

let bridge: EvenAppBridge | null = null;
let location: LatLng | null = null;
let accuracy: number | null = null;
let zoomIndex = 1; // z13 から始める
let format: Format = 'gray4';
let busy = false;
let lastError = '';
let lastNote = 'starting';
let fetchMs = 0;
let inkMs = 0;
let missingTiles = 0;

const timings = new Map<string, Timing>();

function record(key: string, label: string, bytes: number, ms: number, result: string): void {
  const existing = timings.get(key) ?? { label, bytes, samples: [], lastResult: result };
  existing.samples.push(ms);
  existing.bytes = bytes;
  existing.lastResult = result;
  // 直近 9 件だけ見る。古いものは条件が違う可能性がある。
  if (existing.samples.length > 9) existing.samples.shift();
  timings.set(key, existing);
}

function stats(timing: Timing): string {
  const sorted = [...timing.samples].sort((a, b) => a - b);
  const min = Math.round(sorted[0] ?? 0);
  const max = Math.round(sorted[sorted.length - 1] ?? 0);
  const median = Math.round(sorted[Math.floor(sorted.length / 2)] ?? 0);
  return `${String(min).padStart(4)}/${String(median).padStart(4)}/${String(max).padStart(4)}`;
}

function nearbyGroups(from: LatLng): StationGroup[] {
  return nearest(from, groupStations(usableStations(master)), {
    limit: 12,
    maxDistanceMeters: 2000,
  }).map((entry) => entry.item);
}

/** 地図の上に現在地と駅を重ねる。地図があるので半径は圧縮しない。 */
function overlay(bitmap: Bitmap, window: Parameters<typeof toWindowPixel>[1], from: LatLng, groups: StationGroup[]): void {
  groups.forEach((group, index) => {
    const at = toWindowPixel(group, window);
    bitmap.disc(at.x, at.y, 2, LEVEL.bright);
    bitmap.ring(at.x, at.y, 4, LEVEL.mid);
    if (index === 0) {
      bitmap.ring(at.x, at.y, 7, LEVEL.bright);
      bitmap.ring(at.x, at.y, 8, LEVEL.bright);
    }
  });

  const here = toWindowPixel(from, window);
  bitmap.cross(here.x, here.y, 8, LEVEL.bright);
  bitmap.set(here.x, here.y, LEVEL.off);
}

async function sendImage(
  container: { id: number; name: string },
  bitmap: Bitmap,
  key: string,
  label: string,
): Promise<void> {
  if (!bridge) return;

  const data = bitmap.toNumberArray(format === 'gray4');
  const started = performance.now();
  let result = 'n/a';
  try {
    const outcome = await bridge.updateImageRawData(
      new ImageRawDataUpdate({
        containerID: container.id,
        containerName: container.name,
        imageData: data,
      }),
    );
    result = ImageRawDataUpdateResult.isSuccess(outcome) ? 'ok' : String(outcome);
  } catch (error) {
    result = 'throw';
    lastError = String(error).slice(0, 60);
  }
  record(key, label, data.length, performance.now() - started, result);
}

async function runCycle(): Promise<void> {
  if (busy) return;
  busy = true;
  lastError = '';

  try {
    if (!location) {
      lastNote = 'no location yet';
      await paint();
      return;
    }

    const zoom = ZOOMS[zoomIndex]!;
    const groups = nearbyGroups(location);

    // 1. 実地図
    lastNote = `fetching z${zoom}…`;
    await paint();

    const map = await fetchMapBitmap(location, zoom, MAX_IMAGE_WIDTH, MAX_IMAGE_HEIGHT);
    fetchMs = map.fetchMs;
    inkMs = map.inkMs;
    missingTiles = map.missing;
    overlay(map.bitmap, map.window, location, groups);

    // 2. 模式図（同じ場所・同じ駅。見比べるため）
    const stations: MapStation[] = groups.map((group) => ({
      id: group.name,
      name: group.name,
      lat: group.lat,
      lng: group.lng,
    }));
    const schematic = renderStationMap({
      width: MAX_IMAGE_WIDTH,
      height: MAX_IMAGE_HEIGHT,
      origin: location,
      stations,
      selectedId: stations[0]?.id ?? null,
    });

    drawPreview(map.bitmap, schematic.bitmap);

    lastNote = 'sending…';
    await paint();

    await sendImage(MAP, map.bitmap, `map-${format}`, `地図 ${format}`);
    await sendImage(SCHEMA, schematic.bitmap, `sch-${format}`, `模式 ${format}`);

    lastNote = `z${zoom} done`;
  } catch (error) {
    lastError = String(error).slice(0, 60);
    lastNote = 'failed';
  } finally {
    busy = false;
    await paint();
  }
}

function screenText(): string {
  const lines: string[] = [];
  const zoom = ZOOMS[zoomIndex]!;

  lines.push('MAPPROBE');
  if (location) {
    const scale = metersPerPixel(location.lat, zoom);
    lines.push(`${location.lat.toFixed(4)},${location.lng.toFixed(4)}`);
    lines.push(`±${accuracy === null ? '?' : Math.round(accuracy)}m  z${zoom} ${scale.toFixed(1)}m/px`);
    lines.push(`範囲 ${((MAX_IMAGE_WIDTH * scale) / 1000).toFixed(1)}x${((MAX_IMAGE_HEIGHT * scale) / 1000).toFixed(1)}km`);
  } else {
    lines.push('位置情報 待ち');
  }

  lines.push('');
  lines.push(`tile ${Math.round(fetchMs)}ms  ink ${Math.round(inkMs)}ms`);
  if (missingTiles > 0) lines.push(`欠けタイル ${missingTiles}`);

  lines.push('');
  lines.push('送信 min/med/max ms');
  if (timings.size === 0) {
    lines.push('  (まだ)');
  } else {
    for (const timing of timings.values()) {
      lines.push(`${timing.label} ${stats(timing)}`);
      lines.push(`  ${timing.bytes}B n${timing.samples.length} ${timing.lastResult}`);
    }
  }

  lines.push('');
  lines.push(`形式 ${format}`);
  lines.push(lastError ? `err ${lastError}` : lastNote);
  lines.push('');
  lines.push('tap:再取得 上下:ズーム');
  lines.push('出典 国土地理院(加工)');

  return lines.join('\n');
}

/**
 * 同じビットマップをブラウザの canvas にも出す。
 *
 * タイル取得 → canvas → 減色 → 重ね合わせ、までは実機と完全に同じ経路なので、
 * G2 が無くてもここまでは確かめられる。実機でしか分からないのは、この先の
 * 転送時間と、透過ディスプレイでの実際の見え方だけ。
 */
function drawPreview(map: Bitmap | null, schematic: Bitmap | null): void {
  const canvas = document.getElementById('preview');
  if (!(canvas instanceof HTMLCanvasElement)) return;
  const context = canvas.getContext('2d');
  if (!context) return;

  context.fillStyle = '#000';
  context.fillRect(0, 0, canvas.width, canvas.height);

  const put = (bitmap: Bitmap, offsetY: number): void => {
    const image = context.createImageData(bitmap.width, bitmap.height);
    for (let y = 0; y < bitmap.height; y += 1) {
      for (let x = 0; x < bitmap.width; x += 1) {
        const level = bitmap.get(x, y);
        const index = (y * bitmap.width + x) * 4;
        image.data[index] = level * 2;
        image.data[index + 1] = level * 17;
        image.data[index + 2] = level * 6;
        image.data[index + 3] = 255;
      }
    }
    context.putImageData(image, 0, offsetY);
  };

  if (map) put(map, 0);
  if (schematic) put(schematic, MAX_IMAGE_HEIGHT);
}

async function paint(): Promise<void> {
  const content = screenText();
  const dom = document.getElementById('screen');
  if (dom) dom.textContent = content;

  if (!bridge) return;
  try {
    await bridge.textContainerUpgrade(
      new TextContainerUpgrade({ containerID: TEXT.id, containerName: TEXT.name, content }),
    );
  } catch (error) {
    console.warn('textContainerUpgrade failed', error);
  }
}

async function createPage(): Promise<void> {
  if (!bridge) return;

  const result = await bridge.createStartUpPageContainer(
    new CreateStartUpPageContainer({
      containerTotalNum: 3,
      textObject: [
        new TextContainerProperty({
          xPosition: TEXT.x,
          yPosition: TEXT.y,
          width: TEXT.width,
          height: TEXT.height,
          paddingLength: 4,
          borderWidth: 0,
          containerID: TEXT.id,
          containerName: TEXT.name,
          content: screenText(),
          textColor: 4,
          isEventCapture: 1,
        }),
      ],
      imageObject: [
        new ImageContainerProperty({
          xPosition: MAP.x,
          yPosition: MAP.y,
          width: MAP.width,
          height: MAP.height,
          containerID: MAP.id,
          containerName: MAP.name,
        }),
        new ImageContainerProperty({
          xPosition: SCHEMA.x,
          yPosition: SCHEMA.y,
          width: SCHEMA.width,
          height: SCHEMA.height,
          containerID: SCHEMA.id,
          containerName: SCHEMA.name,
        }),
      ],
      menuObject: new MenuContainerProperty({
        menuItems: [
          new MenuItemProperty({ itemID: MENU_FORMAT, itemName: 'Gray4 / Gray8' }),
          new MenuItemProperty({ itemID: MENU_RERUN, itemName: 'Re-run' }),
          new MenuItemProperty({ itemID: MENU_EXIT, itemName: 'Exit' }),
        ],
      }),
    }),
  );

  if (result !== StartUpPageCreateResult.success) {
    lastError = `page create: ${StartUpPageCreateResult[result] ?? result}`;
  }
}

async function handleEvent(event: EvenHubEvent): Promise<void> {
  const sys = event.sysEvent;

  // ダブルタップは textEvent ではなく sysEvent で届く（実機で確認済み・
  // ドキュメントの表とは違う）。ルートで終了ダイアログを出さないと審査で落ちる。
  if (sys && isDoubleClick(sys.eventType)) {
    await bridge?.shutDownPageContainer(1);
    return;
  }

  const menu = event.menuItemClickEvent;
  if (menu?.itemID !== undefined) {
    switch (menu.itemID) {
      case MENU_FORMAT:
        format = format === 'gray4' ? 'gray8' : 'gray4';
        await runCycle();
        break;
      case MENU_RERUN:
        await runCycle();
        break;
      case MENU_EXIT:
        await bridge?.shutDownPageContainer(1);
        break;
    }
    return;
  }

  const text = event.textEvent;
  if (!text) return;

  if (isDoubleClick(text.eventType)) {
    await bridge?.shutDownPageContainer(1);
    return;
  }
  if (isScrollUp(text.eventType)) {
    zoomIndex = (zoomIndex - 1 + ZOOMS.length) % ZOOMS.length;
    await runCycle();
    return;
  }
  if (isScrollDown(text.eventType)) {
    zoomIndex = (zoomIndex + 1) % ZOOMS.length;
    await runCycle();
    return;
  }
  if (isClick(text.eventType)) {
    await runCycle();
  }
}

/**
 * URL で現在地を指定できるようにしておく。`?lat=35.5376&lng=139.7420`
 * ブラウザやシミュレータには位置情報 API が無いので、実機以外で地図を
 * 確かめるにはこれが要る。
 */
function locationFromUrl(): LatLng | null {
  try {
    const params = new URLSearchParams(globalThis.location?.search ?? '');
    const lat = Number(params.get('lat'));
    const lng = Number(params.get('lng'));
    if (Number.isFinite(lat) && Number.isFinite(lng) && lat !== 0 && lng !== 0) {
      return { lat, lng };
    }
  } catch {
    // URL が読めない環境でも落とさない。
  }
  return null;
}

async function main(): Promise<void> {
  location = locationFromUrl();

  bridge = await waitForEvenAppBridge().catch(() => null);
  await createPage();

  if (bridge) {
    bridge.onEvenHubEvent((event: EvenHubEvent) => {
      void handleEvent(event);
    });
    bridge.onAppLocationChanged((fix) => {
      location = { lat: fix.latitude, lng: fix.longitude };
    });

    try {
      const fix = await bridge.getAppLocation({
        accuracy: AppLocationAccuracy.High,
        timeoutMs: 8000,
      });
      // 取れなければ URL 指定のままにする。
      if (fix) {
        location = { lat: fix.latitude, lng: fix.longitude };
        accuracy = fix.accuracy ?? null;
      }
    } catch (error) {
      lastError = `location: ${String(error).slice(0, 40)}`;
    }
  }

  await runCycle();
}

void main();
