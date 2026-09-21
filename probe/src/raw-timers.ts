/**
 * SDK を import する前の素のタイマーを捕まえる。
 *
 * SDK は読み込み時に setInterval / setTimeout を差し替える（コンソールに
 * `[ShadowTimers] setInterval id=.. queued` が出る）。この挙動は公式ドキュメントに
 * 記載がない。そのため「タイマーが飛んだ」ことだけでは
 *   - WebView 自体が suspend された
 *   - SDK の shadow timer がキューに溜めていた
 * のどちらなのか区別できない。
 *
 * このモジュールは main.ts の **最初の import** に置くこと。
 * 差し替え前の関数を保持しておき、両系統のギャップを別々に測って切り分ける。
 */

export const rawSetInterval: typeof setInterval = globalThis.setInterval.bind(globalThis);
export const rawSetTimeout: typeof setTimeout = globalThis.setTimeout.bind(globalThis);

/** SDK 読み込み後に差し替えられたかどうかを判定するための元の参照。 */
const originalSetInterval = globalThis.setInterval;

export function isSetIntervalPatched(): boolean {
  return globalThis.setInterval !== originalSetInterval;
}
