/**
 * 東京次発 — Even G2 で次の電車までの残り時間を出す。
 *
 * 画面は 3 つ。近くの駅を選び、方面を選ぶと、カウントダウンに入る。
 * 前回の選択を覚えているので、同じ駅の近くにいれば起動してすぐカウントダウンになる。
 *
 * 実機検証（2026-09-21）で確かめた前提:
 * - 日本語のグリフは firmware のフォントにある。駅名をそのまま出せる。
 * - IMU の単位は G。pitch = asin(x) で、見上げると + になる。
 *   HeadUp Display そのものは使えないが、前面にいる間なら同じ体験を自前で作れる。
 */

import {
  AppLocationAccuracy,
  CreateStartUpPageContainer,
  EvenAppBridge,
  ImuReportPace,
  MenuContainerProperty,
  MenuItemProperty,
  OsEventTypeList,
  RebuildPageContainer,
  StartUpPageCreateResult,
  TextContainerUpgrade,
  waitForEvenAppBridge,
  type EvenHubEvent,
} from '@evenrealities/even_hub_sdk';

import masterData from '../../data/stations.json' with { type: 'json' };
import { OdptClient } from '../../src/odpt/client.js';
import type { Departure } from '../../src/core/departures.js';
import { distanceMeters } from '../../src/core/geo.js';
import type { MasterStation, StationGroup, StationMaster } from '../../src/core/master.js';
import { PeekDetector, pitchDegrees } from '../../src/core/pitch.js';
import { TokyoJihatsuService, type NearbyStation } from '../../src/core/service.js';
import { COUNTDOWN } from './layout.js';
import {
  aboutText,
  countdownPage,
  countdownTexts,
  directionPickerPage,
  noticePage,
  stationPickerPage,
  type DirectionOption,
  type PageContainers,
} from './screens.js';
import {
  loadSelection,
  saveSelection,
  RESUME_RADIUS_METERS,
  type HostStorage,
} from './selection.js';

const master = masterData as unknown as StationMaster;

/** ODPT ガイドライン 3.1 で表示が要る連絡先。公開前に専用アドレスへ差し替える。 */
const CONTACT_EMAIL = 'async.sync@gmail.com';

const TICK_MS = 1000;
const BRIDGE_TIMEOUT_MS = 3000;

const MENU_RESELECT = 1;
const MENU_PEEK = 2;
const MENU_ABOUT = 3;
const MENU_EXIT = 4;

type Screen = 'notice' | 'stations' | 'directions' | 'countdown' | 'about';

let bridge: EvenAppBridge | null = null;
let hostStorage: HostStorage | null = null;
let service: TokyoJihatsuService;

let screen: Screen = 'notice';
let noticeBody = '起動中…';
let pageCreated = false;

let currentLocation: { lat: number; lng: number } | null = null;
let nearby: NearbyStation[] = [];
let selectedGroup: StationGroup | null = null;
let directionOptions: DirectionOption[] = [];
let selection: { station: MasterStation; direction: DirectionOption['direction'] } | null = null;
let departures: Departure[] = [];
let lastRemainingText = '';

const peek = new PeekDetector();
/** 見上げたときだけ本文を出す。実機で体験を確かめたうえで既定を on にしている。 */
let peekEnabled = true;

async function connectBridge(): Promise<{ bridge: EvenAppBridge | null; hostConnected: boolean }> {
  const candidate = await Promise.race([
    waitForEvenAppBridge(),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), BRIDGE_TIMEOUT_MS)),
  ]).catch(() => null);

  if (!candidate) return { bridge: null, hostConnected: false };
  if (!hasFlutterHost()) return { bridge: candidate, hostConnected: false };

  const hostConnected = await Promise.race([
    candidate
      .getDeviceInfo()
      .then((info) => info !== null)
      .catch(() => false),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), BRIDGE_TIMEOUT_MS)),
  ]);
  return { bridge: candidate, hostConnected };
}

function hasFlutterHost(): boolean {
  const handler = (globalThis as { flutter_inappwebview?: { callHandler?: unknown } })
    .flutter_inappwebview;
  return typeof handler?.callHandler === 'function';
}

function menu(): MenuContainerProperty {
  return new MenuContainerProperty({
    menuItems: [
      new MenuItemProperty({ itemID: MENU_RESELECT, itemName: '駅を選び直す' }),
      new MenuItemProperty({
        itemID: MENU_PEEK,
        itemName: peekEnabled ? '常時表示にする' : '見上げ表示にする',
      }),
      new MenuItemProperty({ itemID: MENU_ABOUT, itemName: 'データについて' }),
      new MenuItemProperty({ itemID: MENU_EXIT, itemName: '終了' }),
    ],
  });
}

/** 今の画面のコンテナ定義。 */
function currentPage(): PageContainers {
  switch (screen) {
    case 'stations':
      return stationPickerPage(nearby);
    case 'directions':
      return directionPickerPage(selectedGroup?.name ?? '', directionOptions);
    case 'countdown': {
      if (!selection) return noticePage('駅が選ばれていません');
      return countdownPage(countdownTexts(selection.station, selection.direction, departures, Date.now()));
    }
    case 'about':
      return noticePage(aboutText(master.sourceDate, CONTACT_EMAIL));
    case 'notice':
    default:
      return noticePage(noticeBody);
  }
}

/** ページ全体を作り直す。List の内容を変えるにはこれが要る。 */
async function renderPage(): Promise<void> {
  const page = currentPage();
  syncDom(page);
  if (!bridge) return;

  if (!pageCreated) {
    const result = await bridge.createStartUpPageContainer(
      new CreateStartUpPageContainer({ ...page, menuObject: menu() }),
    );
    if (result === StartUpPageCreateResult.success) pageCreated = true;
    else console.warn('createStartUpPageContainer failed', result);
    return;
  }

  // rebuild は menuObject を省くとメニューごと消えるので毎回渡す。
  await bridge.rebuildPageContainer(new RebuildPageContainer({ ...page, menuObject: menu() }));
}

/**
 * カウントダウンだけを差し替える。
 * 全体 rebuild はちらつくうえ状態が飛ぶので、毎秒の更新はこちらを使う。
 */
async function updateRemaining(): Promise<void> {
  if (screen !== 'countdown' || !selection) return;

  const hidden = peekEnabled && !peek.isUp;
  const texts = countdownTexts(selection.station, selection.direction, departures, Date.now());
  const content = hidden ? ' ' : texts.remaining;
  if (content === lastRemainingText) return;
  lastRemainingText = content;

  syncDom(currentPage());
  if (!bridge) return;

  await bridge.textContainerUpgrade(
    new TextContainerUpgrade({
      containerID: COUNTDOWN.remaining.id,
      containerName: COUNTDOWN.remaining.name,
      content,
    }),
  );
  await bridge.textContainerUpgrade(
    new TextContainerUpgrade({
      containerID: COUNTDOWN.upcoming.id,
      containerName: COUNTDOWN.upcoming.name,
      content: hidden ? ' ' : texts.upcoming,
    }),
  );
}

/** ブラウザでも同じ内容を読めるようにしておく（実機なしで確認するため）。 */
function syncDom(page: PageContainers): void {
  const element = document.getElementById('screen');
  if (!element) return;
  const lines = [
    ...(page.textObject ?? []).map((t) => t.content ?? ''),
    ...(page.listObject ?? []).flatMap((l) => l.itemContainer?.itemName ?? []),
  ];
  element.textContent = lines.join('\n');
}

async function showNotice(body: string): Promise<void> {
  screen = 'notice';
  noticeBody = body;
  await renderPage();
}

async function showStations(): Promise<void> {
  if (!currentLocation) {
    await showNotice('現在地が取れません。\n位置情報の許可を確認してください。');
    return;
  }

  nearby = service.nearbyStations(currentLocation, { limit: 12 });
  if (nearby.length === 0) {
    await showNotice('近くに対応している駅がありません。\n\n対応: 東京メトロ / 都営 / 横浜市営 /\nTX / 多摩モノレール / ゆりかもめ / りんかい線');
    return;
  }

  screen = 'stations';
  await renderPage();
}

async function showDirections(group: StationGroup): Promise<void> {
  selectedGroup = group;
  directionOptions = service.directionChoices(group);
  screen = 'directions';
  await renderPage();
}

async function showCountdown(
  station: MasterStation,
  direction: DirectionOption['direction'],
): Promise<void> {
  selection = { station, direction };
  lastRemainingText = '';

  await showNotice(`${station.name}\n時刻表を取得中…`);

  try {
    const snapshot = await service.countdown(station, direction, { count: 3 });
    departures = snapshot.departures;
  } catch (error) {
    console.warn('countdown failed', error);
    await showNotice('時刻表を取得できませんでした。\n通信を確認してからもう一度。');
    return;
  }

  if (currentLocation) {
    await saveSelection(
      {
        stationId: station.id,
        directionId: direction.id,
        lat: currentLocation.lat,
        lng: currentLocation.lng,
      },
      hostStorage,
    );
  }

  screen = 'countdown';
  await renderPage();
}

/** 発車済みの列車を落とし、残りが少なくなったら引き直す。 */
async function refreshDepartures(): Promise<void> {
  if (!selection) return;

  const now = Date.now();
  const remaining = departures.filter((departure) => departure.at.getTime() > now);

  if (remaining.length !== departures.length) {
    departures = remaining;
    await renderPage();
  }

  if (remaining.length >= 2) return;

  try {
    const snapshot = await service.countdown(selection.station, selection.direction, { count: 3 });
    departures = snapshot.departures;
    await renderPage();
  } catch (error) {
    console.warn('refresh failed', error);
  }
}

async function handleEvent(event: EvenHubEvent): Promise<void> {
  const sys = event.sysEvent;

  if (sys?.eventType === OsEventTypeList.IMU_DATA_REPORT && sys.imuData) {
    if (!peekEnabled || screen !== 'countdown') return;
    if (peek.update(pitchDegrees(sys.imuData.x ?? 0))) {
      lastRemainingText = ''; // 状態が変わったら必ず描き直す
      await updateRemaining();
    }
    return;
  }

  const menuClick = event.menuItemClickEvent;
  if (menuClick?.itemID !== undefined) {
    await handleMenu(menuClick.itemID);
    return;
  }

  const list = event.listEvent;
  if (list && list.eventType === OsEventTypeList.CLICK_EVENT) {
    const index = list.currentSelectItemIndex ?? 0;
    if (screen === 'stations') {
      const picked = nearby[index];
      if (picked) await showDirections(picked.group);
    } else if (screen === 'directions') {
      const picked = directionOptions[index];
      if (picked) await showCountdown(picked.station, picked.direction);
    }
    return;
  }

  const text = event.textEvent;
  if (text && (text.eventType === OsEventTypeList.CLICK_EVENT || text.eventType === undefined)) {
    if (screen === 'about') {
      screen = selection ? 'countdown' : 'stations';
      await renderPage();
    }
  }
}

async function handleMenu(itemID: number): Promise<void> {
  switch (itemID) {
    case MENU_RESELECT:
      await showStations();
      break;
    case MENU_PEEK:
      peekEnabled = !peekEnabled;
      lastRemainingText = '';
      await renderPage();
      break;
    case MENU_ABOUT:
      screen = 'about';
      await renderPage();
      break;
    case MENU_EXIT:
      // ルートページからの終了は必ず mode 1（システムの確認ダイアログ）。
      await bridge?.shutDownPageContainer(1);
      break;
    default:
      break;
  }
}

/** 前回の選択が使えるなら、そのままカウントダウンに入る。 */
async function resumeIfPossible(): Promise<boolean> {
  const saved = await loadSelection(hostStorage);
  if (!saved || !currentLocation) return false;

  const distance = distanceMeters(currentLocation, { lat: saved.lat, lng: saved.lng });
  if (distance > RESUME_RADIUS_METERS) return false;

  const station = master.stations.find((candidate) => candidate.id === saved.stationId);
  const direction = station?.directions.find((candidate) => candidate.id === saved.directionId);
  if (!station || !direction) return false;

  await showCountdown(station, direction);
  return true;
}

async function main(): Promise<void> {
  const token = import.meta.env.VITE_ODPT_TOKEN;
  service = new TokyoJihatsuService(master, new OdptClient({ consumerKey: token ?? '' }));

  const connection = await connectBridge();
  bridge = connection.hostConnected ? connection.bridge : null;
  if (bridge) {
    hostStorage = {
      get: (key) => bridge!.getLocalStorage(key),
      set: (key, value) => bridge!.setLocalStorage(key, value),
    };
  }

  await showNotice('現在地を確認中…');

  if (!bridge) {
    // ブラウザで画面を確認するとき用の仮の現在地（月島）。
    // ホストが居ない＝実機ではないので、実際の利用には影響しない。
    currentLocation = { lat: 35.663757, lng: 139.783912 };
  }

  if (bridge) {
    bridge.onEvenHubEvent((event) => {
      void handleEvent(event);
    });
    bridge.onAppLocationChanged((fix) => {
      currentLocation = { lat: fix.latitude, lng: fix.longitude };
    });

    try {
      const fix = await bridge.getAppLocation({
        accuracy: AppLocationAccuracy.Medium,
        timeoutMs: 8000,
      });
      if (fix) currentLocation = { lat: fix.latitude, lng: fix.longitude };
    } catch (error) {
      console.warn('location failed', error);
    }

    try {
      await bridge.startAppLocationUpdates({
        accuracy: AppLocationAccuracy.Medium,
        intervalMs: 10_000,
      });
    } catch (error) {
      console.warn('location stream failed', error);
    }

    try {
      await bridge.imuControl(true, ImuReportPace.P200);
    } catch (error) {
      console.warn('imu failed', error);
    }
  }

  if (!(await resumeIfPossible())) {
    await showStations();
  }

  setInterval(() => {
    void (async () => {
      await updateRemaining();
      await refreshDepartures();
    })();
  }, TICK_MS);
}

void main();
