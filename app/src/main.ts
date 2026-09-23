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
import { OdptClient, OdptError } from '../../src/odpt/client.js';
import type { Departure } from '../../src/core/departures.js';
import { distanceMeters } from '../../src/core/geo.js';
import type { MasterStation, StationGroup, StationMaster } from '../../src/core/master.js';
import { PeekDetector, pitchDegrees } from '../../src/core/pitch.js';
import { TokyoJihatsuService, type NearbyStation } from '../../src/core/service.js';
import { isClick, isDoubleClick } from './events.js';
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
const CONTACT_EMAIL = 'async.sync+tokyojihatsu@gmail.com';

/** 徒歩圏に対応駅が無かったときに広げる範囲。 */
const WIDE_SEARCH_METERS = 30_000;

/**
 * 時刻表を引き直す最短間隔。
 *
 * これが無いと、残り本数が少なくなった時点から毎秒ネットワークを叩く。
 * プロキシのレート制限（毎分 60）に当たって 429 が返り、カウントダウンが
 * 黙って止まる。実際にこの症状が出た。
 */
const MIN_REFRESH_INTERVAL_MS = 30_000;

/** これだけ続けて失敗したら、黙っていないで画面に出す。 */
const FAILURES_BEFORE_NOTICE = 3;

/**
 * 前回の駅が、いまの最寄り駅よりこれ以上遠ければ選び直させる。
 *
 * 順位で見ると、候補が少ない場所では遠い駅も上位に入ってしまい判定にならない。
 * 距離の差で見れば、候補の数に左右されない。
 */
const RESUME_MAX_EXTRA_METERS = 500;

const TICK_MS = 1000;
const BRIDGE_TIMEOUT_MS = 3000;

/**
 * 起動画面を最低これだけ出す。
 *
 * 位置情報がすぐ返ると一瞬で消えて、見上げ表示が有効だと気づけない。
 * かといって長いと起動の邪魔になるので、読み取れる最短にとどめる。
 */
const SPLASH_MIN_MS = 700;

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
let nearbyHeadline = '近くの駅';
let selectedGroup: StationGroup | null = null;
let directionOptions: DirectionOption[] = [];
let selection: { station: MasterStation; direction: DirectionOption['direction'] } | null = null;
let departures: Departure[] = [];
/** 遅延情報が作られた時刻。使うなら画面に出す義務がある。 */
let delayGeneratedAt: Date | null = null;
let lastRemainingText = '';

/** 時刻表の引き直しが進行中か。tick が重なって二重に走るのを防ぐ。 */
let refreshInFlight = false;
/** 最後に引き直しを試みた時刻。連打を防ぐ。 */
let lastRefreshAt = 0;
/** 連続で失敗した回数。黙って止まらないよう画面に出す判断に使う。 */
let refreshFailures = 0;
/** 直近の失敗理由。原因を実機で切り分けるため画面に出す。 */
let lastError = '';

const peek = new PeekDetector();
/**
 * 見上げたときだけカウントダウンを出すか。**既定は on。**
 *
 * 以前は off にしていた。見上げ判定の初期値が「伏せている」だったせいで、
 * 起動しても「一瞬出て消える」ようにしか見えなかったため。いまは
 * 見えている側から始まるので、起動直後は必ず読める。
 * 起動画面でも有効であることを知らせて、消えたときに驚かせないようにする。
 */
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

/**
 * 失敗の理由を短く言い表す。
 *
 * ネットワークが Even アプリ側で止められている場合と、API がエラーを返した場合とで
 * 打ち手がまったく違うので、実機の画面から区別できるようにしておく。
 */
function describeError(error: unknown): string {
  if (error instanceof OdptError) {
    return `ODPT が ${error.status} を返しました`;
  }
  if (error instanceof TypeError) {
    // WKWebView は "Load failed"、Chromium は "Failed to fetch"
    return `通信がブロックされました\n(${error.message})`;
  }
  if (error instanceof Error) {
    return `${error.name}: ${error.message}`.slice(0, 120);
  }
  return String(error).slice(0, 120);
}

/**
 * ODPT への口を作る。
 *
 * プロキシの URL が設定されていればそちらを使う。`.ehpk` は誰でも展開できるので、
 * **公開ビルドではプロキシ必須**（FAQ:「Move keys behind a server-side proxy.」）。
 * 鍵を直接埋めるのはローカル検証のときだけに留める。
 */
/**
 * チャレンジ限定ライセンスのデータ用の口。
 * エンドポイントもトークンも別なので、プロキシ側で /challenge/ に振り分ける。
 */
function createChallengeClient(): OdptClient | null {
  const proxyUrl = import.meta.env.VITE_ODPT_PROXY;
  if (!proxyUrl) return null;

  const appKey = import.meta.env.VITE_PROXY_APP_KEY;
  // .../api/v4 を .../challenge/api/v4 に差し替える
  const challengeUrl = proxyUrl.replace(/\/api\/v4\/?$/, '/challenge/api/v4');
  if (challengeUrl === proxyUrl) return null;

  return new OdptClient({
    consumerKey: '',
    baseUrl: challengeUrl,
    headers: appKey ? { 'X-Tokyojihatsu-Key': appKey } : {},
  });
}

function createOdptClient(): OdptClient {
  const proxyUrl = import.meta.env.VITE_ODPT_PROXY;
  if (proxyUrl) {
    // ODPT の鍵はプロキシ側が持つので、こちらは空でよい。
    // 共有鍵は「誰でも叩ける API にしない」ためのもの。バンドルから取り出せるが、
    // URL を知っただけでは使えない状態にはなる（ライセンス第 8 条 4(1)）。
    const appKey = import.meta.env.VITE_PROXY_APP_KEY;
    return new OdptClient({
      consumerKey: '',
      baseUrl: proxyUrl,
      headers: appKey ? { 'X-Tokyojihatsu-Key': appKey } : {},
    });
  }

  const token = import.meta.env.VITE_ODPT_TOKEN;
  if (!token) {
    console.warn('VITE_ODPT_PROXY も VITE_ODPT_TOKEN も未設定です');
  }
  return new OdptClient({ consumerKey: token ?? '' });
}

/**
 * URL で指定された現在地。`?lat=35.6569&lng=139.7547`
 *
 * シミュレータは位置情報 API を持たない（getAppLocation は
 * unknown variant で失敗する）ので、審査用のスクリーンショットも
 * 開発中の画面確認もこれがないとできない。
 * 実機では位置情報が取れるので、この値は使われない。
 */
function locationFromUrl(): { lat: number; lng: number } | null {
  try {
    const params = new URLSearchParams(globalThis.location?.search ?? '');
    const lat = Number(params.get('lat'));
    const lng = Number(params.get('lng'));
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    if (lat === 0 && lng === 0) return null;
    return { lat, lng };
  } catch {
    return null;
  }
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
      return stationPickerPage(nearby, nearbyHeadline);
    case 'directions':
      return directionPickerPage(selectedGroup?.name ?? '', directionOptions);
    case 'countdown': {
      if (!selection) return noticePage('駅が選ばれていません');
      return countdownPage(
        countdownTexts(selection.station, selection.direction, departures, Date.now(), {
          stale: refreshFailures >= FAILURES_BEFORE_NOTICE,
          delayGeneratedAt,
        }),
      );
    }
    case 'about':
      return noticePage(
        aboutText(master.sourceDate, CONTACT_EMAIL, {
          challengeExpiresAt: master.challengeExpiresAt,
        }),
      );
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
  const texts = countdownTexts(selection.station, selection.direction, departures, Date.now(), {
    stale: refreshFailures >= FAILURES_BEFORE_NOTICE,
    delayGeneratedAt,
  });

  // 時計は秒が動くので毎回変わる。差分判定は残り時間側で行う。
  const content = hidden ? ' ' : texts.remaining;
  const unchanged = content === lastRemainingText;
  lastRemainingText = content;

  syncDom(currentPage());
  if (!bridge) return;

  // 時計は伏せない。
  // 見上げ表示で消したいのは「駅と次発」であって、時刻そのものではない。
  // 時計だけ残しておけば、駅から離れていても作業時間の目安に使える。
  await bridge.textContainerUpgrade(
    new TextContainerUpgrade({
      containerID: COUNTDOWN.clock.id,
      containerName: COUNTDOWN.clock.name,
      content: texts.clock,
    }),
  );

  if (unchanged) return;

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
  // 駅名も伏せる。ここが残っていると、伏せているつもりでも視界に文字が残る。
  await bridge.textContainerUpgrade(
    new TextContainerUpgrade({
      containerID: COUNTDOWN.header.id,
      containerName: COUNTDOWN.header.name,
      content: hidden ? ' ' : texts.header,
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
  nearbyHeadline = '近くの駅';

  if (nearby.length === 0) {
    // 徒歩圏に無ければ範囲を広げて最寄りを出す。ODPT で時刻表が取れるのは
    // 7 事業者だけなので、JR・東急・京急しか通っていない地域では徒歩圏に
    // 1 駅も無いことが普通にある。黙って「ありません」で終わらせない。
    nearby = service.nearbyStations(currentLocation, {
      limit: 12,
      maxDistanceMeters: WIDE_SEARCH_METERS,
    });
    nearbyHeadline = '徒歩圏になし・最寄りの駅';
  }

  if (nearby.length === 0) {
    await showNotice(
      [
        'この付近に対応している駅がありません。',
        '',
        '対応: 東京メトロ / 都営 / 横浜市営 /',
        'TX / 多摩モノレール / ゆりかもめ /',
        'りんかい線',
        '',
        'JR・東急・京急・京王・小田急・西武・東武は',
        'ODPT が駅時刻表を出していないため扱えません。',
      ].join('\n'),
    );
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
    delayGeneratedAt = snapshot.delayGeneratedAt;
  } catch (error) {
    console.warn('countdown failed', error);
    lastError = describeError(error);
    await showNotice(
      [
        '時刻表を取得できませんでした。',
        '',
        lastError,
        '',
        'タップで駅選択に戻る',
      ].join('\n'),
    );
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

/**
 * 発車済みの列車を落とし、残りが少なくなったら引き直す。
 *
 * 気をつけている点が 3 つある。いずれも実機でカウントダウンが止まった原因。
 * - 引き直しは最短 30 秒間隔。毎秒叩くとレート制限に当たって 429 になる
 * - 進行中なら次を走らせない。tick が重なると departures を奪い合う
 * - 失敗しても黙って止まらない。続くようなら画面に出す
 */
async function refreshDepartures(): Promise<void> {
  if (!selection || refreshInFlight) return;

  const now = Date.now();
  const upcoming = departures.filter((departure) => departure.at.getTime() > now);

  // 発車済みを落とす。ここで rebuild はしない（ちらつくうえ状態が飛ぶ）。
  // 次の updateRemaining が textContainerUpgrade で反映する。
  if (upcoming.length !== departures.length) {
    departures = upcoming;
    lastRemainingText = '';
  }

  if (upcoming.length >= 2) return;
  if (now - lastRefreshAt < MIN_REFRESH_INTERVAL_MS) return;

  refreshInFlight = true;
  lastRefreshAt = now;
  try {
    const snapshot = await service.countdown(selection.station, selection.direction, { count: 3 });
    departures = snapshot.departures;
    delayGeneratedAt = snapshot.delayGeneratedAt;
    refreshFailures = 0;
    lastRemainingText = '';
  } catch (error) {
    refreshFailures += 1;
    console.warn('refresh failed', refreshFailures, error);
    lastRemainingText = '';
  } finally {
    refreshInFlight = false;
  }
}

async function handleEvent(event: EvenHubEvent): Promise<void> {
  const sys = event.sysEvent;

  // 開発時だけ、届いたイベントの素性を残す。
  // ダブルタップが期待どおり届いているかは、これを見ないと分からない。
  if (import.meta.env.DEV && sys?.eventType !== OsEventTypeList.IMU_DATA_REPORT) {
    console.log(
      '[event]',
      JSON.stringify({
        screen,
        text: event.textEvent?.eventType,
        list: event.listEvent?.eventType,
        sys: sys?.eventType,
        menu: event.menuItemClickEvent?.itemID,
        index: event.listEvent?.currentSelectItemIndex,
      }),
    );
  }

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

  // ダブルタップは sysEvent で届く。
  // ドキュメントは「textEvent / listEvent に届き、例外はコンテキストメニューと
  // 長押しだけ」と書いているが、実測では sysEvent に来る（simulator 0.9.5）。
  // textEvent / listEvent も見ておくのは、経路が変わっても取りこぼさないため。
  if (
    isDoubleClick(event.sysEvent?.eventType) ||
    isDoubleClick(event.textEvent?.eventType) ||
    isDoubleClick(event.listEvent?.eventType)
  ) {
    await handleBack();
    return;
  }

  const list = event.listEvent;
  if (list && isClick(list.eventType)) {
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
  if (text && isClick(text.eventType)) {
    if (screen === 'about') {
      screen = selection ? 'countdown' : 'stations';
      await renderPage();
    } else if (screen === 'notice' && lastError) {
      lastError = '';
      await showStations();
    }
  }
}

/**
 * ダブルタップの行き先。
 *
 * ドキュメントいわく「normally back, dismiss, or the exit dialog on a root page」。
 * 内部の画面では前へ戻り、ルートでは終了確認を出す。
 *
 * ルートに当たるのは、起動して最初に出る画面——駅がまだ決まっていなければ
 * 駅選択、前回の選択を復元したならカウントダウン。審査はそこを見る。
 */
async function handleBack(): Promise<void> {
  switch (screen) {
    case 'directions':
      // 方面を選んでいる途中なら駅選択へ戻す。ここで終了すると操作をやり直せない。
      await showStations();
      return;
    case 'about':
      screen = selection ? 'countdown' : 'stations';
      await renderPage();
      return;
    default:
      await requestExit();
  }
}

/**
 * 終了を頼む。
 *
 * mode 1 はシステムの終了確認ダイアログ。mode 0（即終了）も、自前の確認 UI も
 * ルートページでは審査に通らない。
 */
async function requestExit(): Promise<void> {
  await bridge?.shutDownPageContainer(1);
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
      await requestExit();
      break;
    default:
      break;
  }
}

/**
 * 前回の選択が使えるなら、そのままカウントダウンに入る。
 *
 * 判断は 2 段構え。
 * 1. 前に選んだ場所の近くにいるか（保存しているのは選択時の現在地）
 * 2. **その駅が、いまの最寄り駅と比べて極端に遠くないか**
 *
 * 2 が要る。保存しているのは自分の位置であって駅の位置ではないので、
 * 1 だけだと「同じ場所で起動した」という理由で、はるかに遠い駅が
 * 復元され続ける。対応範囲が広がって近くに駅ができても気づけない
 * （実際、6.4km 先の駅が復元されて 142m の駅が出なかった）。
 */
async function resumeIfPossible(): Promise<boolean> {
  const saved = await loadSelection(hostStorage);
  if (!saved || !currentLocation) return false;

  const movedFrom = distanceMeters(currentLocation, { lat: saved.lat, lng: saved.lng });
  if (movedFrom > RESUME_RADIUS_METERS) return false;

  const station = master.stations.find((candidate) => candidate.id === saved.stationId);
  const direction = station?.directions.find((candidate) => candidate.id === saved.directionId);
  if (!station || !direction) return false;

  // いまの最寄り駅と比べて、前回の駅が目に見えて遠ければ選び直させる。
  const nearestNow = service.nearbyStations(currentLocation, {
    limit: 1,
    maxDistanceMeters: WIDE_SEARCH_METERS,
  })[0];
  if (nearestNow) {
    const toSaved = distanceMeters(currentLocation, station);
    if (toSaved - nearestNow.distanceMeters > RESUME_MAX_EXTRA_METERS) return false;
  }

  await showCountdown(station, direction);
  return true;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main(): Promise<void> {
  const splashUntil = Date.now() + SPLASH_MIN_MS;
  service = new TokyoJihatsuService(master, createOdptClient(), createChallengeClient());

  const connection = await connectBridge();
  bridge = connection.hostConnected ? connection.bridge : null;
  if (bridge) {
    hostStorage = {
      get: (key) => bridge!.getLocalStorage(key),
      set: (key, value) => bridge!.setLocalStorage(key, value),
    };
  }

  await showNotice(
    ['東京次発', '', peekEnabled ? '見上げ表示 ON' : '常時表示', '', '現在地を確認中…'].join('\n'),
  );

  // URL で指定されていれば、それを初期値にする（シミュレータ・開発用）。
  currentLocation = locationFromUrl();

  if (!bridge && !currentLocation) {
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
      // 取れなければ URL 指定（あれば）のままにする。
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

  // 位置情報がすぐ返っても、起動画面は読み取れるだけ出す。
  const splashLeft = splashUntil - Date.now();
  if (splashLeft > 0) await sleep(splashLeft);

  if (!(await resumeIfPossible())) {
    await showStations();
  }

  // 表示は毎秒。引き直しは refreshDepartures 側で間隔を空ける。
  // 表示と取得を同じ await の鎖に乗せると、通信待ちのあいだ時計が止まる。
  setInterval(() => {
    void updateRemaining();
    void refreshDepartures();
  }, TICK_MS);
}

void main();
