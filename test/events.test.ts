import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { OsEventTypeList } from '@evenrealities/even_hub_sdk';
import { isClick, isDoubleClick, isScrollDown, isScrollUp } from '../app/src/events.js';

describe('タップの判定', () => {
  it('CLICK_EVENT はタップ', () => {
    assert.equal(isClick(OsEventTypeList.CLICK_EVENT), true);
  });

  it('undefined もタップとして扱う', () => {
    // SDK が 0 を undefined に正規化することがある。これを落とすとタップが効かない
    assert.equal(isClick(undefined), true);
  });

  it('スワイプをタップと誤認しない', () => {
    assert.equal(isClick(OsEventTypeList.SCROLL_TOP_EVENT), false);
    assert.equal(isClick(OsEventTypeList.SCROLL_BOTTOM_EVENT), false);
    assert.equal(isClick(OsEventTypeList.DOUBLE_CLICK_EVENT), false);
    assert.equal(isClick(OsEventTypeList.LONG_PRESS_EVENT), false);
  });
});

describe('スワイプの判定', () => {
  it('上下を取り違えない', () => {
    assert.equal(isScrollUp(OsEventTypeList.SCROLL_TOP_EVENT), true);
    assert.equal(isScrollUp(OsEventTypeList.SCROLL_BOTTOM_EVENT), false);
    assert.equal(isScrollDown(OsEventTypeList.SCROLL_BOTTOM_EVENT), true);
    assert.equal(isScrollDown(OsEventTypeList.SCROLL_TOP_EVENT), false);
  });

  it('undefined はスワイプではない', () => {
    assert.equal(isScrollUp(undefined), false);
    assert.equal(isScrollDown(undefined), false);
  });
});

describe('ダブルタップの判定', () => {
  it('DOUBLE_CLICK_EVENT だけを拾う', () => {
    // 無反応だと審査で自動的に落とされるので、取りこぼさないことを固定する
    assert.equal(isDoubleClick(OsEventTypeList.DOUBLE_CLICK_EVENT), true);
    assert.equal(isDoubleClick(OsEventTypeList.CLICK_EVENT), false);
    assert.equal(isDoubleClick(undefined), false);
    assert.equal(isDoubleClick(OsEventTypeList.SCROLL_TOP_EVENT), false);
  });
});

describe('ダブルタップの届き方', () => {
  /** 本体（app/src/main.ts）と同じ判定。 */
  function isDoubleTapEvent(event: {
    sysEvent?: { eventType?: OsEventTypeList };
    textEvent?: { eventType?: OsEventTypeList };
    listEvent?: { eventType?: OsEventTypeList };
  }): boolean {
    return (
      isDoubleClick(event.sysEvent?.eventType) ||
      isDoubleClick(event.textEvent?.eventType) ||
      isDoubleClick(event.listEvent?.eventType)
    );
  }

  it('sysEvent で届いても拾う', () => {
    // 実測ではここに来る。ドキュメントには書かれていない
    assert.equal(
      isDoubleTapEvent({ sysEvent: { eventType: OsEventTypeList.DOUBLE_CLICK_EVENT } }),
      true,
    );
  });

  it('textEvent / listEvent で届いても拾う', () => {
    assert.equal(
      isDoubleTapEvent({ textEvent: { eventType: OsEventTypeList.DOUBLE_CLICK_EVENT } }),
      true,
    );
    assert.equal(
      isDoubleTapEvent({ listEvent: { eventType: OsEventTypeList.DOUBLE_CLICK_EVENT } }),
      true,
    );
  });

  it('ただのタップをダブルタップと誤認しない', () => {
    assert.equal(isDoubleTapEvent({ textEvent: { eventType: undefined } }), false);
    assert.equal(
      isDoubleTapEvent({ listEvent: { eventType: OsEventTypeList.CLICK_EVENT } }),
      false,
    );
  });

  it('長押しをダブルタップと誤認しない', () => {
    assert.equal(
      isDoubleTapEvent({ sysEvent: { eventType: OsEventTypeList.LONG_PRESS_EVENT } }),
      false,
    );
  });
});
