import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { OsEventTypeList } from '@evenrealities/even_hub_sdk';
import { createDeviceLease, isExitEvent, type ReleasableBridge } from '../app/src/lifecycle.js';

function fakeBridge(options: { failImu?: boolean; failLocation?: boolean } = {}) {
  const calls: string[] = [];
  const bridge: ReleasableBridge = {
    async imuControl(isOpen: boolean) {
      calls.push(`imu:${isOpen}`);
      if (options.failImu) throw new Error('imu boom');
      return true;
    },
    async stopAppLocationUpdates() {
      calls.push('stopLocation');
      if (options.failLocation) throw new Error('loc boom');
      return true;
    },
  };
  return { bridge, calls };
}

describe('isExitEvent', () => {
  it('SYSTEM_EXIT と ABNORMAL_EXIT は終了', () => {
    assert.equal(isExitEvent(OsEventTypeList.SYSTEM_EXIT_EVENT), true);
    assert.equal(isExitEvent(OsEventTypeList.ABNORMAL_EXIT_EVENT), true);
  });

  it('FOREGROUND_EXIT は終了ではない', () => {
    // 前面から外れただけで戻ってくることがある。ここで IMU を切ると
    // 復帰後に見上げ表示が黙って効かなくなる。
    assert.equal(isExitEvent(OsEventTypeList.FOREGROUND_EXIT_EVENT), false);
  });

  it('タップや未定義では終了しない', () => {
    assert.equal(isExitEvent(OsEventTypeList.CLICK_EVENT), false);
    assert.equal(isExitEvent(undefined), false);
  });
});

describe('createDeviceLease', () => {
  it('開けた IMU を閉じ、位置情報も止める', () => {
    // 審査の指摘そのもの。「IMU を有効にしたまま無効化していない」
    const lease = createDeviceLease();
    const { bridge, calls } = fakeBridge();

    lease.noteImuEnabled();
    return lease.release(bridge).then(() => {
      assert.deepEqual(calls, ['imu:false', 'stopLocation']);
      assert.equal(lease.released, true);
    });
  });

  it('IMU を開けていなければ閉じにいかない', async () => {
    const lease = createDeviceLease();
    const { bridge, calls } = fakeBridge();

    await lease.release(bridge);
    assert.deepEqual(calls, ['stopLocation'], 'IMU には触らない');
  });

  it('何度呼んでも 1 回しか解放しない', async () => {
    // 終了イベントは重複して届きうるし、pagehide とも重なる。
    const lease = createDeviceLease();
    const { bridge, calls } = fakeBridge();

    lease.noteImuEnabled();
    await Promise.all([lease.release(bridge), lease.release(bridge)]);
    await lease.release(bridge);

    assert.deepEqual(calls, ['imu:false', 'stopLocation']);
  });

  it('IMU の解放に失敗しても位置情報は止める', async () => {
    const errors: string[] = [];
    const lease = createDeviceLease((what) => errors.push(what));
    const { bridge, calls } = fakeBridge({ failImu: true });

    lease.noteImuEnabled();
    await lease.release(bridge);

    assert.deepEqual(calls, ['imu:false', 'stopLocation'], '片方が落ちても続ける');
    assert.deepEqual(errors, ['imuControl(false)']);
  });

  it('ブリッジが無くても落ちない', async () => {
    const lease = createDeviceLease();
    lease.noteImuEnabled();
    await assert.doesNotReject(() => lease.release(null));
    assert.equal(lease.released, true);
  });
});
