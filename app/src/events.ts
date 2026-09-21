/**
 * 入力イベントの判定。
 *
 * SDK は CLICK_EVENT（値 0）を undefined に正規化することがある
 * （公式ドキュメント: 「SDK normalizes 0 to undefined in some cases」）。
 * `=== OsEventTypeList.CLICK_EVENT` だけで見ると undefined を取りこぼし、
 * タップが効かなくなる。スワイプは 1 / 2 で明示的に来るので混ざらない。
 */

import { OsEventTypeList } from '@evenrealities/even_hub_sdk';

export function isClick(eventType: OsEventTypeList | undefined): boolean {
  return eventType === OsEventTypeList.CLICK_EVENT || eventType === undefined;
}

/**
 * ダブルタップ。
 *
 * 審査では「ルートページのダブルタップで `shutDownPageContainer(1)` が呼ばれ、
 * システムの終了確認ダイアログが出ること」を見られる。無反応のまま出すと
 * 自動的に落とされる（「Apps that exit silently or do nothing on double-tap
 * are rejected.」）。
 */
export function isDoubleClick(eventType: OsEventTypeList | undefined): boolean {
  return eventType === OsEventTypeList.DOUBLE_CLICK_EVENT;
}

export function isScrollUp(eventType: OsEventTypeList | undefined): boolean {
  return eventType === OsEventTypeList.SCROLL_TOP_EVENT;
}

export function isScrollDown(eventType: OsEventTypeList | undefined): boolean {
  return eventType === OsEventTypeList.SCROLL_BOTTOM_EVENT;
}
