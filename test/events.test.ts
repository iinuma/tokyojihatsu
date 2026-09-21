import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { OsEventTypeList } from '@evenrealities/even_hub_sdk';
import { isClick, isScrollDown, isScrollUp } from '../app/src/events.js';

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
