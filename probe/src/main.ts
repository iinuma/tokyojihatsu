/**
 * 東京次発 — 実機検証プラグイン（probe）
 *
 * Notion 要件の「実機でのみ確認できること」を数字で残すためだけのアプリ。
 * カウントダウン本体は入っていない。確かめるのは次の 4 点。
 *
 *   1. iPhone をロックして数分置いた後、JS は止まるのか（止まるなら何秒）。
 *      → 1 秒 tick の実経過を測る。tick が飛べば WebView は suspend されていた。
 *   2. 位置情報の stream は止まるのか。止まったまま復帰するのか。
 *   3. プラグインが前面のとき、見上げる/外す/画面が消えると何のイベントが来るか。
 *      FOREGROUND_ENTER_EVENT / FOREGROUND_EXIT_EVENT は SDK の enum にはあるが
 *      ドキュメントの表には載っていない。実機で飛ぶかを見る。
 *   4. 日本語のグリフが firmware のフォントにあるか（サマリの JP 行）。
 *
 * ブリッジが無い環境（素のブラウザ）でも DOM に同じ内容を出して動く。
 */

// この import は必ず SDK より前に置く（SDK がタイマーを差し替えるため）。
import { isSetIntervalPatched, rawSetInterval, rawSetTimeout } from './raw-timers.js';

import {
  CreateStartUpPageContainer,
  EvenAppBridge,
  ImuReportPace,
  MenuContainerProperty,
  MenuItemProperty,
  OsEventTypeList,
  StartUpPageCreateResult,
  TextContainerProperty,
  TextContainerUpgrade,
  AppLocationAccuracy,
  waitForEvenAppBridge,
  type EvenHubEvent,
} from '@evenrealities/even_hub_sdk';

import {
  addEvent,
  clear,
  heartbeat,
  persist,
  recordImu,
  restore,
  type HostStorage,
  type ProbeState,
} from './state.js';
import { logPageCount, renderDump, renderLog, renderSummary } from './display.js';

const CONTAINER_ID = 1;
const CONTAINER_NAME = 'probe';
const TICK_MS = 1000;
const PERSIST_EVERY_TICKS = 5;
const BRIDGE_TIMEOUT_MS = 3000;

const MENU_CLEAR = 1;
const MENU_DUMP = 2;
const MENU_EXIT = 3;

type View = 'summary' | 'log';

let state: ProbeState;
let bridge: EvenAppBridge | null = null;
let hostStorage: HostStorage | null = null;

let view: View = 'summary';
let logPage = 0;
let tickCount = 0;
let lastEvent = 'started';

let location: { lat: number; lng: number; accuracy?: number } | null = null;
let imu: { x: number; y: number; z: number } | null = null;
let device: { battery?: number; wearing?: boolean } | null = null;
let storageFlags = { web: false, host: false };

/**
 * ブリッジを掴む。
 *
 * 注意: 素のブラウザでも SDK は window.EvenAppBridge を作るので
 * `waitForEvenAppBridge()` は解決してしまう。ホスト（Even アプリの Flutter 側）が
 * いるかどうかは別に確かめる必要がある。いなければ描画呼び出しは全部失敗し、
 * コンソールが `Flutter handler not available` で埋まる。
 */
async function connectBridge(): Promise<{ bridge: EvenAppBridge | null; hostConnected: boolean }> {
  const candidate = await Promise.race([
    waitForEvenAppBridge(),
    new Promise<null>((resolve) => rawSetTimeoutSafe(() => resolve(null), BRIDGE_TIMEOUT_MS)),
  ]).catch(() => null);

  if (!candidate) return { bridge: null, hostConnected: false };

  // SDK は Flutter の inappwebview ハンドラ越しにホストへ送る。
  // これが無ければ呼び出しは黙って捨てられ、警告だけがコンソールに溜まる。
  if (!hasFlutterHost()) return { bridge: candidate, hostConnected: false };

  // ハンドラがあっても本当に応答するとは限らないので 1 往復させる。
  const hostConnected = await Promise.race([
    candidate
      .getDeviceInfo()
      .then((info) => info !== null)
      .catch(() => false),
    new Promise<boolean>((resolve) => rawSetTimeoutSafe(() => resolve(false), BRIDGE_TIMEOUT_MS)),
  ]);

  return { bridge: candidate, hostConnected };
}

function hasFlutterHost(): boolean {
  const handler = (globalThis as { flutter_inappwebview?: { callHandler?: unknown } })
    .flutter_inappwebview;
  return typeof handler?.callHandler === 'function';
}

function rawSetTimeoutSafe(fn: () => void, ms: number): void {
  rawSetTimeout(fn, ms);
}

function note(detail: string, kind: Parameters<typeof addEvent>[1] = 'note'): void {
  lastEvent = detail;
  addEvent(state, kind, detail);
}

function currentContent(): string {
  const input = {
    state,
    now: Date.now(),
    tickCount,
    storage: storageFlags,
    location,
    imu,
    device,
    lastEvent,
  };
  return view === 'summary' ? renderSummary(input) : renderLog(state, logPage);
}

async function paint(): Promise<void> {
  const content = currentContent();

  const dom = document.getElementById('log');
  if (dom) dom.textContent = content;

  if (!bridge) return;
  try {
    await bridge.textContainerUpgrade(
      new TextContainerUpgrade({
        containerID: CONTAINER_ID,
        containerName: CONTAINER_NAME,
        content,
      }),
    );
  } catch (error) {
    // 描画に失敗しても計測は続ける
    console.warn('textContainerUpgrade failed', error);
  }
}

async function createPage(): Promise<void> {
  if (!bridge) return;

  const result = await bridge.createStartUpPageContainer(
    new CreateStartUpPageContainer({
      containerTotalNum: 1,
      textObject: [
        new TextContainerProperty({
          xPosition: 0,
          yPosition: 0,
          width: 576,
          height: 288,
          paddingLength: 4,
          borderWidth: 0,
          containerID: CONTAINER_ID,
          containerName: CONTAINER_NAME,
          content: currentContent(),
          textColor: 4,
          isEventCapture: 1,
        }),
      ],
      menuObject: new MenuContainerProperty({
        menuItems: [
          new MenuItemProperty({ itemID: MENU_CLEAR, itemName: 'Clear log' }),
          new MenuItemProperty({ itemID: MENU_DUMP, itemName: 'Dump to console' }),
          new MenuItemProperty({ itemID: MENU_EXIT, itemName: 'Exit' }),
        ],
      }),
    }),
  );

  if (result !== StartUpPageCreateResult.success) {
    note(`page create failed: ${StartUpPageCreateResult[result] ?? result}`);
  }
}

function describeSysEvent(type: OsEventTypeList | undefined): string | null {
  switch (type) {
    case OsEventTypeList.FOREGROUND_ENTER_EVENT:
      return 'foreground enter';
    case OsEventTypeList.FOREGROUND_EXIT_EVENT:
      return 'foreground exit';
    case OsEventTypeList.ABNORMAL_EXIT_EVENT:
      return 'abnormal exit';
    case OsEventTypeList.SYSTEM_EXIT_EVENT:
      return 'system exit';
    case OsEventTypeList.LONG_PRESS_EVENT:
      return 'long press';
    case OsEventTypeList.LONG_PRESS_RELEASE_EVENT:
      return 'long press release';
    default:
      return null;
  }
}

async function handleEvent(event: EvenHubEvent): Promise<void> {
  const sys = event.sysEvent;

  // IMU は件数が多いのでログに積まず、最新値だけ持つ。
  if (sys?.eventType === OsEventTypeList.IMU_DATA_REPORT && sys.imuData) {
    imu = { x: sys.imuData.x ?? 0, y: sys.imuData.y ?? 0, z: sys.imuData.z ?? 0 };
    recordImu(state, imu.x, imu.y, imu.z);
    return;
  }

  if (sys) {
    const described = describeSysEvent(sys.eventType);
    if (described) {
      const source = sys.eventSource === undefined ? '' : ` src${sys.eventSource}`;
      note(`${described}${source}`, 'fg-enter');
      await persist(state, hostStorage);
      await paint();
      return;
    }
  }

  const menu = event.menuItemClickEvent;
  if (menu?.itemID !== undefined) {
    await handleMenu(menu.itemID);
    return;
  }

  const text = event.textEvent;
  if (text) {
    switch (text.eventType) {
      case OsEventTypeList.CLICK_EVENT:
      case undefined: // SDK が 0 を undefined に正規化することがある
        view = view === 'summary' ? 'log' : 'summary';
        logPage = 0;
        note(`tap -> ${view}`, 'input');
        break;
      case OsEventTypeList.SCROLL_TOP_EVENT:
        logPage = (logPage - 1 + logPageCount(state)) % logPageCount(state);
        note('swipe up', 'input');
        break;
      case OsEventTypeList.SCROLL_BOTTOM_EVENT:
        logPage = (logPage + 1) % logPageCount(state);
        note('swipe down', 'input');
        break;
      case OsEventTypeList.DOUBLE_CLICK_EVENT:
        note('double tap', 'input');
        break;
      default:
        note(`text event ${text.eventType}`, 'input');
        break;
    }
    await paint();
  }
}

async function handleMenu(itemID: number): Promise<void> {
  switch (itemID) {
    case MENU_CLEAR:
      state = await clear(state, hostStorage);
      view = 'summary';
      logPage = 0;
      lastEvent = 'log cleared';
      break;
    case MENU_DUMP:
      console.log(renderDump(state));
      note('dumped to console', 'menu');
      break;
    case MENU_EXIT:
      note('exit requested', 'exit');
      await persist(state, hostStorage);
      // ルートページからの終了は必ず mode 1（システムの確認ダイアログ）。
      await bridge?.shutDownPageContainer(1);
      return;
    default:
      note(`menu ${itemID}`, 'menu');
      break;
  }
  await persist(state, hostStorage);
  await paint();
}

async function wireBridge(): Promise<void> {
  if (!bridge) return;

  bridge.onLaunchSource((source) => {
    state.launchSource = String(source);
    note(`launch from ${source}`, 'boot');
    void persist(state, hostStorage);
    void paint();
  });

  bridge.onEvenHubEvent((event) => {
    void handleEvent(event);
  });

  bridge.onDeviceStatusChanged((status) => {
    device = { battery: status.batteryLevel, wearing: status.isWearing };
    note(`device batt${status.batteryLevel ?? '-'} wear${status.isWearing ? 'y' : 'n'}`, 'device');
  });

  bridge.onAppLocationChanged((fix) => {
    const now = Date.now();
    const sinceLast = state.lastLocationAt ? now - state.lastLocationAt : 0;
    location = { lat: fix.latitude, lng: fix.longitude, accuracy: fix.accuracy };
    state.locationCount += 1;
    state.lastLocationAt = now;
    // 間隔が開いたものだけ記録する。毎回積むとログが位置で埋まる。
    if (sinceLast > 30_000) {
      addEvent(state, 'location', `更新が ${Math.round(sinceLast / 1000)}s ぶり`, now);
    }
  });

  // 単発で 1 回取ってから継続取得を始める。
  try {
    const fix = await bridge.getAppLocation({
      accuracy: AppLocationAccuracy.Medium,
      timeoutMs: 8000,
    });
    if (fix) {
      location = { lat: fix.latitude, lng: fix.longitude, accuracy: fix.accuracy };
      state.locationCount += 1;
      state.lastLocationAt = Date.now();
      note('location fix', 'location');
    } else {
      note('location: null (denied or no fix)', 'location-fail');
    }
  } catch (error) {
    note(`location error: ${String(error)}`, 'location-fail');
  }

  try {
    // distanceFilter は付けない。10m 動かないと push が来ない設定だと、
    // 「ストリームが死んでいる」のか「動いていないだけ」なのか区別できない。
    await bridge.startAppLocationUpdates({
      accuracy: AppLocationAccuracy.Medium,
      intervalMs: 5000,
    });
  } catch (error) {
    note(`location stream error: ${String(error)}`, 'location-fail');
  }

  // 見上げ動作を捉えるには 1 秒間隔では粗い。振れ幅を見たいので細かめに回す。
  try {
    await bridge.imuControl(true, ImuReportPace.P200);
  } catch (error) {
    note(`imu error: ${String(error)}`, 'note');
  }
}

/** SDK 差し替え後のタイマー。アプリが実際に使う経路。 */
async function tick(): Promise<void> {
  tickCount += 1;
  const gap = heartbeat(state, 'shadow');

  if (gap > 0) {
    lastEvent = `sdk timer resumed after ${Math.round(gap / 1000)}s`;
    console.log('[probe] sdk timer gap', gap, 'ms');
    // 復帰直後は取りこぼしたくないので即保存する。
    await persist(state, hostStorage);
  } else if (tickCount % PERSIST_EVERY_TICKS === 0) {
    await persist(state, hostStorage);
  }

  await paint();
}

/** SDK が差し替える前のタイマー。WebView 自体が止まったかを見る。 */
function rawTick(): void {
  const gap = heartbeat(state, 'raw');
  if (gap > 0) {
    console.log('[probe] raw timer gap', gap, 'ms');
    void persist(state, hostStorage);
  }
}

async function main(): Promise<void> {
  const timersPatched = isSetIntervalPatched();
  const connection = await connectBridge();
  bridge = connection.hostConnected ? connection.bridge : null;

  if (bridge) {
    hostStorage = {
      get: (key) => bridge!.getLocalStorage(key),
      set: (key, value) => bridge!.setLocalStorage(key, value),
    };
  }

  const restored = await restore(hostStorage, Date.now());
  state = restored.state;
  state.timersPatched = timersPatched;
  state.hostConnected = connection.hostConnected;
  storageFlags = { web: restored.fromWebLocalStorage, host: restored.fromHostStorage };

  note(`timers patched=${timersPatched} host=${connection.hostConnected}`, 'boot');
  if (!connection.hostConnected) {
    note('host not reachable (browser mode)');
  }

  await createPage();
  await wireBridge();
  await persist(state, hostStorage);
  await paint();

  setInterval(() => {
    void tick();
  }, TICK_MS);

  rawSetInterval(() => {
    rawTick();
  }, TICK_MS);

  // 背面に回る直前に取れる最後の機会。ブラウザ側のイベントも記録しておく。
  document.addEventListener('visibilitychange', () => {
    note(`visibility ${document.visibilityState}`, document.hidden ? 'fg-exit' : 'fg-enter');
    void persist(state, hostStorage);
  });
}

void main();
