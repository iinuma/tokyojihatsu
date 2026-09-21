import { strict as assert } from 'node:assert';
import { beforeEach, describe, it } from 'node:test';

// state.ts は WebView の localStorage を使う。Node では自前のスタブを置く。
class MemoryStorage {
  private map = new Map<string, string>();
  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
  clear(): void {
    this.map.clear();
  }
}

const storage = new MemoryStorage();
(globalThis as unknown as { localStorage: MemoryStorage }).localStorage = storage;

const {
  addEvent,
  clear,
  createState,
  GAP_THRESHOLD_MS,
  heartbeat,
  persist,
  restore,
  formatDuration,
} = await import('../probe/src/state.js');

/** ホスト側保存のスタブ。 */
function hostStorage(initial?: string) {
  let value = initial ?? '';
  return {
    get: async () => value,
    set: async (_key: string, next: string) => {
      value = next;
      return true;
    },
    read: () => value,
  };
}

beforeEach(() => {
  storage.clear();
});

describe('タイマーのギャップ検出', () => {
  it('しきい値未満の遅れは記録しない', () => {
    const state = createState(1_000);
    assert.equal(heartbeat(state, 'shadow', 1_000 + GAP_THRESHOLD_MS - 1), 0);
    assert.equal(state.shadow.count, 0);
  });

  it('しきい値以上の遅れをギャップとして記録する', () => {
    const state = createState(0);
    const gap = heartbeat(state, 'shadow', 300_000); // 5 分
    assert.equal(gap, 300_000);
    assert.equal(state.shadow.count, 1);
    assert.equal(state.shadow.maxMs, 300_000);
    assert.equal(state.events.at(-1)?.kind, 'gap');
  });

  it('2 系統を別々に数える', () => {
    const state = createState(0);
    heartbeat(state, 'shadow', 300_000);
    assert.equal(state.shadow.count, 1);
    assert.equal(state.raw.count, 0);

    heartbeat(state, 'raw', 300_000);
    assert.equal(state.raw.count, 1);
  });

  it('最大値を保ち、最後の値を上書きする', () => {
    const state = createState(0);
    heartbeat(state, 'shadow', 300_000);
    heartbeat(state, 'shadow', 310_000); // 10 秒のギャップ
    assert.equal(state.shadow.maxMs, 300_000);
    assert.equal(state.shadow.lastMs, 10_000);
    assert.equal(state.shadow.count, 2);
  });
});

describe('記録の復元', () => {
  it('保存がなければ cold start として始める', async () => {
    const result = await restore(null, 1_000);
    assert.equal(result.state.bootCount, 1);
    assert.equal(result.fromWebLocalStorage, false);
    assert.equal(result.fromHostStorage, false);
  });

  it('保存があれば起動回数を増やし、離れていた時間を記録する', async () => {
    const first = createState(0);
    first.bootCount = 1;
    await persist(first, null);

    const result = await restore(null, 300_000);
    assert.equal(result.state.bootCount, 2);
    assert.equal(result.fromWebLocalStorage, true);
    assert.match(result.state.events.at(-1)?.detail ?? '', /前回から 5m00s/);
  });

  it('スキーマが古い保存は捨てる', async () => {
    storage.setItem('tokyojihatsu.probe.v2', JSON.stringify({ version: 1, events: [] }));
    const result = await restore(null, 1_000);
    assert.equal(result.fromWebLocalStorage, false);
    assert.equal(result.state.bootCount, 1);
  });

  it('壊れた JSON でも落ちない', async () => {
    storage.setItem('tokyojihatsu.probe.v2', '{not json');
    const result = await restore(null, 1_000);
    assert.equal(result.fromWebLocalStorage, false);
  });

  it('ホスト側の保存だけが残っていても復元する', async () => {
    const saved = createState(0);
    saved.bootCount = 3;
    const host = hostStorage(JSON.stringify(saved));

    const result = await restore(host, 10_000);
    assert.equal(result.fromWebLocalStorage, false);
    assert.equal(result.fromHostStorage, true);
    assert.equal(result.state.bootCount, 4);
  });

  it('両方ある場合は新しいほうを採る', async () => {
    const older = createState(0);
    older.bootCount = 1;
    const newer = createState(0);
    newer.bootCount = 9;
    newer.shadow.lastAt = 500_000;

    storage.setItem('tokyojihatsu.probe.v2', JSON.stringify(older));
    const host = hostStorage(JSON.stringify(newer));

    const result = await restore(host, 600_000);
    assert.equal(result.state.bootCount, 10); // newer 由来
  });

  it('復元時にギャップ計測をリセットする', async () => {
    const saved = createState(0);
    saved.shadow.count = 5;
    await persist(saved, null);

    const result = await restore(null, 10_000);
    assert.equal(result.state.shadow.count, 0);
    assert.equal(result.state.shadow.lastAt, 10_000);
  });
});

describe('ログ', () => {
  it('上限を超えたら古いものから捨てる', () => {
    const state = createState(0);
    for (let i = 0; i < 200; i += 1) addEvent(state, 'note', `e${i}`, i);
    assert.equal(state.events.length, 120);
    assert.equal(state.events[0]?.detail, 'e80');
  });

  it('消去しても起動回数と接続状態は残す', async () => {
    const state = createState(0);
    state.bootCount = 7;
    state.timersPatched = true;
    addEvent(state, 'note', 'old');

    const cleared = await clear(state, null);
    assert.equal(cleared.bootCount, 7);
    assert.equal(cleared.timersPatched, true);
    assert.equal(cleared.events.length, 1);
    assert.equal(cleared.events[0]?.detail, 'ログを消去した');
  });
});

describe('時間の表記', () => {
  it('秒・分・時で切り替える', () => {
    assert.equal(formatDuration(5_000), '5s');
    assert.equal(formatDuration(65_000), '1m05s');
    assert.equal(formatDuration(3_700_000), '1h01m');
  });
});
