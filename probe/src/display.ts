/**
 * G2 の 576x288 に流し込む文字列を組み立てる。
 *
 * 表示の制約（公式ドキュメント）:
 * - 左寄せ・上寄せ固定。中央寄せはスペース埋めしかない。フォントは等幅ではない。
 * - 全画面のテキストコンテナで概ね 400〜500 文字。
 * - firmware のフォントにない文字は黙って落ちる。
 *   日本語が出るかどうか自体が検証項目なので、サマリに 1 行だけテスト行を置く。
 *   その行が空白になったら日本語は使えない、と分かる。
 */

import { clockJst, formatDuration, type GapTracker, type ProbeState } from './state.js';

export interface DisplayInput {
  state: ProbeState;
  now: number;
  tickCount: number;
  storage: { web: boolean; host: boolean };
  location: { lat: number; lng: number; accuracy?: number } | null;
  imu: { x: number; y: number; z: number } | null;
  device: { battery?: number; wearing?: boolean } | null;
  /** 直近に届いたイベントの短い説明。画面下に 1 行出す。 */
  lastEvent: string;
}

const LOG_LINES_PER_PAGE = 8;

export function renderSummary(input: DisplayInput): string {
  const { state, now, tickCount, storage, location, imu, device } = input;
  const lines: string[] = [];

  lines.push(`PROBE boot#${state.bootCount}  ${clockJst(now)}`);
  lines.push(
    `launch ${state.launchSource}  up ${formatDuration(now - state.sessionBootAt)}  tick ${tickCount}`,
  );

  // 1. ロック復帰でタイマーが止まったか。
  //    sdk = SDK 差し替え後 / raw = 差し替え前。両方止まれば WebView ごと止まった、
  //    sdk だけ止まれば SDK の shadow timer がキューに溜めていた、と読める。
  //    G2 の画面は行数が限られるので 1 行にまとめる。
  lines.push(`stop ${gapLine(state.shadow)} | raw ${gapLine(state.raw)}`);

  lines.push(
    `store web:${storage.web ? 'y' : 'n'} host:${storage.host ? 'y' : 'n'}  ` +
      `bridge:${state.hostConnected ? 'y' : 'n'} patched:${state.timersPatched ? 'y' : 'n'}`,
  );

  // 位置情報が止まるかどうか
  if (location) {
    const age = state.lastLocationAt ? formatDuration(now - state.lastLocationAt) : '-';
    const accuracy = location.accuracy === undefined ? '' : ` ±${Math.round(location.accuracy)}m`;
    lines.push(
      `loc ${state.locationCount}x ${age} ago${accuracy}  ${location.lat.toFixed(4)},${location.lng.toFixed(4)}`,
    );
  } else {
    lines.push('loc: none');
  }

  // 2. 見上げ検出に使えるか。
  //    静止時の |v| が 1.0 前後なら単位は G（重力加速度）で、ピッチ角が計算できる。
  //    頭を上下に振ったとき、どの軸が一番動くかを振れ幅で見る。
  if (imu) {
    const magnitude = Math.sqrt(imu.x ** 2 + imu.y ** 2 + imu.z ** 2);
    lines.push(`imu ${fixed(imu.x)} ${fixed(imu.y)} ${fixed(imu.z)}  |v|${magnitude.toFixed(2)}`);

    const range = state.imuRange;
    if (range) {
      const spread = (i: number) => (range.max[i]! - range.min[i]!).toFixed(1);
      lines.push(`  swing x${spread(0)} y${spread(1)} z${spread(2)}  n${range.samples}`);
    }
  } else {
    lines.push('imu: off');
  }

  if (device) {
    const battery = device.battery === undefined ? '-' : `${device.battery}%`;
    lines.push(`batt ${battery} wear ${device.wearing ? 'y' : 'n'}  ${input.lastEvent}`);
  } else {
    lines.push(`> ${input.lastEvent}`);
  }

  // 日本語が出るかのテスト行。空白になったら firmware のフォントに無い。
  lines.push('JP: 月島 大江戸線 光が丘方面 18:42');

  lines.push('tap:log  swipe:page  hold-tap:menu');

  return lines.join('\n');
}

export function logPageCount(state: ProbeState): number {
  return Math.max(1, Math.ceil(state.events.length / LOG_LINES_PER_PAGE));
}

/** 新しいものから順に見せる。page は 0 始まり。 */
export function renderLog(state: ProbeState, page: number): string {
  const pages = logPageCount(state);
  const safePage = ((page % pages) + pages) % pages;

  const newestFirst = [...state.events].reverse();
  const slice = newestFirst.slice(
    safePage * LOG_LINES_PER_PAGE,
    safePage * LOG_LINES_PER_PAGE + LOG_LINES_PER_PAGE,
  );

  const lines = [`LOG ${safePage + 1}/${pages}  (${state.events.length})`];
  for (const event of slice) {
    lines.push(`${clockJst(event.at)} ${event.kind} ${event.detail}`);
  }
  if (slice.length === 0) lines.push('(empty)');
  lines.push('tap:summary  swipe:page');

  return lines.join('\n');
}

function gapLine(tracker: GapTracker): string {
  if (tracker.count === 0) return 'none';
  return `${tracker.count}x max ${formatDuration(tracker.maxMs)}`;
}

function fixed(value: number): string {
  return Number.isFinite(value) ? value.toFixed(1) : '-';
}

/**
 * ログを 1 本のテキストに書き出す。
 * 実機から結果を持ち帰る手段がないので、最後はこれを画面で読むことになる。
 */
export function renderDump(state: ProbeState): string {
  const lines = [
    `# tokyojihatsu probe dump`,
    `boots ${state.bootCount}  first ${new Date(state.firstBootAt).toISOString()}`,
    `sdk-timer gaps ${state.shadow.count} max ${state.shadow.maxMs}ms`,
    `raw-timer gaps ${state.raw.count} max ${state.raw.maxMs}ms`,
    `timers patched ${state.timersPatched}  bridge ${state.hostConnected}`,
    `locations ${state.locationCount}`,
    `launch ${state.launchSource}`,
    state.imuRange
      ? `imu swing x${(state.imuRange.max[0]! - state.imuRange.min[0]!).toFixed(2)} ` +
        `y${(state.imuRange.max[1]! - state.imuRange.min[1]!).toFixed(2)} ` +
        `z${(state.imuRange.max[2]! - state.imuRange.min[2]!).toFixed(2)} (n=${state.imuRange.samples})`
      : 'imu: no samples',
    '',
  ];
  for (const event of state.events) {
    lines.push(`${new Date(event.at).toISOString()}\t${event.kind}\t${event.detail}`);
  }
  return lines.join('\n');
}
