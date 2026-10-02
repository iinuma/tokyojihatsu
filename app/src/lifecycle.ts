/**
 * 終了時にデバイス資源を返す。
 *
 * **IMU は明示的に切らないと回り続ける。** 見上げ表示のために起動時へ
 * `imuControl(true)` で開けているので、アプリが終わったら閉じる責任がこちらにある。
 * v0.4.4 は「IMU を有効にしたまま無効化していない」という指摘でリジェクトされた。
 * 位置情報の stream も同じ性質なのでまとめて止める。
 *
 * main.ts は読み込み時にアプリを起動してしまい単体で試験できないので、
 * 判断の部分だけここへ出してある。
 */

import { OsEventTypeList } from '@evenrealities/even_hub_sdk';

/** 解放に必要なぶんだけのブリッジ。実物の EvenAppBridge もこれを満たす。 */
export interface ReleasableBridge {
  imuControl(isOpen: boolean, reportFrq?: never): Promise<boolean>;
  stopAppLocationUpdates(): Promise<boolean>;
}

/**
 * 本当に終了したと言えるイベントか。
 *
 * `FOREGROUND_EXIT_EVENT` は含めない。前面から外れただけで戻ってくることが
 * あり、そこで IMU を切ると**復帰後に見上げ表示が黙って効かなくなる**。
 */
export function isExitEvent(eventType: OsEventTypeList | undefined): boolean {
  return (
    eventType === OsEventTypeList.SYSTEM_EXIT_EVENT ||
    eventType === OsEventTypeList.ABNORMAL_EXIT_EVENT
  );
}

export interface DeviceLease {
  /** IMU を開けたことを記録する。開けていなければ閉じにいかない。 */
  noteImuEnabled(): void;
  /** 解放済みか。 */
  readonly released: boolean;
  /**
   * 掴んでいるものを返す。終了イベントは重複して届きうるうえ、
   * pagehide とも重なるので、**何度呼ばれても害がない**ようにしてある。
   * 片方が失敗しても、もう片方は必ず試みる。
   */
  release(bridge: ReleasableBridge | null | undefined): Promise<void>;
}

export function createDeviceLease(
  onError: (what: string, error: unknown) => void = () => {},
): DeviceLease {
  let imuEnabled = false;
  let released = false;

  return {
    noteImuEnabled() {
      imuEnabled = true;
    },
    get released() {
      return released;
    },
    async release(bridge) {
      if (released) return;
      released = true;

      if (bridge && imuEnabled) {
        try {
          await bridge.imuControl(false);
          imuEnabled = false;
        } catch (error) {
          onError('imuControl(false)', error);
        }
      }

      if (bridge) {
        try {
          await bridge.stopAppLocationUpdates();
        } catch (error) {
          onError('stopAppLocationUpdates', error);
        }
      }
    },
  };
}
