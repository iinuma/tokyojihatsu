/**
 * 検証セッションの記録と永続化。
 *
 * 目的は Notion 要件の「実機でのみ確認できること」を数字で残すこと。
 * とくに **JS が止まっていた時間** は、1 秒ごとの tick の実経過を測るのが
 * 最も直接的な証拠になる。tick が飛べば WebView は suspend されていた。
 *
 * 保存先は 2 つある。どちらが生き残るかも検証結果なので両方に書く。
 * - WebView の localStorage（ドキュメント上は「Always survives」）
 * - ホスト側の bridge.setLocalStorage（Even アプリが持つ保存領域）
 */

export type ProbeEventKind =
  | 'boot'
  | 'gap'
  | 'fg-enter'
  | 'fg-exit'
  | 'exit'
  | 'input'
  | 'menu'
  | 'location'
  | 'location-fail'
  | 'device'
  | 'note';

export interface ProbeEvent {
  at: number;
  kind: ProbeEventKind;
  detail: string;
}

/**
 * タイマーが飛んだ量の記録。SDK の shadow timer 経由と素のタイマーの
 * 2 系統を別々に持ち、「SDK が溜めていた」のか「WebView が止まった」のかを分ける。
 */
export interface GapTracker {
  /** 最後にこの系統の tick が走った時刻。 */
  lastAt: number;
  count: number;
  lastMs: number;
  maxMs: number;
}

export function createGapTracker(now: number): GapTracker {
  return { lastAt: now, count: 0, lastMs: 0, maxMs: 0 };
}

export interface ProbeState {
  version: 2;
  /** cold start の累計。main が再実行された回数。 */
  bootCount: number;
  firstBootAt: number;
  sessionBootAt: number;
  /** SDK の setInterval 経由（アプリが実際に使う経路）。 */
  shadow: GapTracker;
  /** SDK が差し替える前の素の setInterval。 */
  raw: GapTracker;
  lastLocationAt: number;
  locationCount: number;
  launchSource: string;
  /** SDK がタイマーを差し替えていたか。 */
  timersPatched: boolean;
  /** Even アプリのホストに繋がっているか（素のブラウザでは false）。 */
  hostConnected: boolean;
  events: ProbeEvent[];
}

const STORAGE_KEY = 'tokyojihatsu.probe.v2';
const MAX_EVENTS = 120;

/** tick がこれ以上遅れたら「JS が止まっていた」と見なす。 */
export const GAP_THRESHOLD_MS = 2500;

export function createState(now: number): ProbeState {
  return {
    version: 2,
    bootCount: 0,
    firstBootAt: now,
    sessionBootAt: now,
    shadow: createGapTracker(now),
    raw: createGapTracker(now),
    lastLocationAt: 0,
    locationCount: 0,
    launchSource: 'unknown',
    timersPatched: false,
    hostConnected: false,
    events: [],
  };
}

export function addEvent(state: ProbeState, kind: ProbeEventKind, detail: string, at = Date.now()): void {
  state.events.push({ at, kind, detail });
  if (state.events.length > MAX_EVENTS) {
    state.events.splice(0, state.events.length - MAX_EVENTS);
  }
}

/**
 * 保存された記録を読む。
 * 形が合わないもの（古いスキーマ、壊れた JSON）は捨てる。アプリを更新すると
 * 実機にも古い形が残るので、ここで弾けないと復帰時に落ちる。
 */
function parse(raw: string | null | undefined): ProbeState | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<ProbeState> | null;
    if (!parsed || parsed.version !== 2) return null;
    if (!isGapTracker(parsed.shadow) || !isGapTracker(parsed.raw)) return null;
    if (!Array.isArray(parsed.events)) return null;
    return parsed as ProbeState;
  } catch {
    return null;
  }
}

function isGapTracker(value: unknown): value is GapTracker {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as GapTracker).lastAt === 'number' &&
    typeof (value as GapTracker).count === 'number'
  );
}

/** どちらの保存先が生き残っていたか。これ自体が検証結果。 */
export interface RestoreResult {
  state: ProbeState;
  fromWebLocalStorage: boolean;
  fromHostStorage: boolean;
}

export interface HostStorage {
  get(key: string): Promise<string>;
  set(key: string, value: string): Promise<boolean>;
}

export async function restore(host: HostStorage | null, now: number): Promise<RestoreResult> {
  let web: ProbeState | null = null;
  try {
    web = parse(localStorage.getItem(STORAGE_KEY));
  } catch {
    web = null; // プライベートモード等で localStorage が使えない場合
  }

  let hostState: ProbeState | null = null;
  if (host) {
    try {
      hostState = parse(await host.get(STORAGE_KEY));
    } catch {
      hostState = null;
    }
  }

  // 新しいほうを採用する。
  const restored =
    web && hostState
      ? web.shadow.lastAt >= hostState.shadow.lastAt
        ? web
        : hostState
      : (web ?? hostState);

  if (!restored) {
    const fresh = createState(now);
    fresh.bootCount = 1;
    addEvent(fresh, 'boot', 'cold start (記録なし)', now);
    return { state: fresh, fromWebLocalStorage: false, fromHostStorage: false };
  }

  const away = now - restored.shadow.lastAt;
  restored.bootCount += 1;
  restored.sessionBootAt = now;
  restored.shadow = createGapTracker(now);
  restored.raw = createGapTracker(now);
  addEvent(
    restored,
    'boot',
    `cold start #${restored.bootCount} 前回から ${formatDuration(away)}`,
    now,
  );

  return {
    state: restored,
    fromWebLocalStorage: web !== null,
    fromHostStorage: hostState !== null,
  };
}

export async function persist(state: ProbeState, host: HostStorage | null): Promise<void> {
  const raw = JSON.stringify(state);
  try {
    localStorage.setItem(STORAGE_KEY, raw);
  } catch {
    // 書けなくても続行する
  }
  if (host) {
    try {
      await host.set(STORAGE_KEY, raw);
    } catch {
      // 同上
    }
  }
}

export async function clear(state: ProbeState, host: HostStorage | null): Promise<ProbeState> {
  const fresh = createState(Date.now());
  fresh.bootCount = state.bootCount;
  fresh.firstBootAt = state.firstBootAt;
  fresh.launchSource = state.launchSource;
  fresh.timersPatched = state.timersPatched;
  fresh.hostConnected = state.hostConnected;
  addEvent(fresh, 'note', 'ログを消去した');
  await persist(fresh, host);
  return fresh;
}

/**
 * tick 1 回分を進め、想定より遅れていたら gap として記録する。
 * 戻り値は検出したギャップ（ms）。遅れていなければ 0。
 *
 * `which` は計測系統。shadow は SDK 差し替え後、raw は差し替え前のタイマー。
 */
export function heartbeat(
  state: ProbeState,
  which: 'shadow' | 'raw',
  now = Date.now(),
): number {
  const tracker = state[which];
  const elapsed = now - tracker.lastAt;
  tracker.lastAt = now;

  if (elapsed < GAP_THRESHOLD_MS) return 0;

  tracker.count += 1;
  tracker.lastMs = elapsed;
  if (elapsed > tracker.maxMs) tracker.maxMs = elapsed;
  addEvent(state, 'gap', `${which} 停止 ${formatDuration(elapsed)}`, now);
  return elapsed;
}

export function formatDuration(ms: number): string {
  if (ms < 0) return '-';
  const totalSeconds = Math.round(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) return `${minutes}m${String(seconds).padStart(2, '0')}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h${String(minutes % 60).padStart(2, '0')}m`;
}

/** 画面に出す短い時刻。JST 固定。 */
export function clockJst(at: number): string {
  const shifted = new Date(at + 9 * 3600_000);
  return shifted.toISOString().slice(11, 19);
}
