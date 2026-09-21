/**
 * 選んだ駅・方面の記憶。
 *
 * 毎回「駅 → 路線 → 方面」を選ばせると負担が大きいので、前回の選択を覚えておき、
 * 同じ駅の近くにいるときはカウントダウンから始める。
 *
 * 保存先は WebView の localStorage とホスト側の両方。ロック復帰で WebView が
 * 作り直される可能性があり、cold start から戻れることが Beta 審査の要件でもある。
 */

export interface StoredSelection {
  version: 1;
  stationId: string;
  directionId: string;
  /** 近くにいるか判定するための座標。 */
  lat: number;
  lng: number;
  savedAt: number;
}

export interface HostStorage {
  get(key: string): Promise<string>;
  set(key: string, value: string): Promise<boolean>;
}

const KEY = 'tokyojihatsu.selection.v1';

/** この距離以内なら、前回の選択をそのまま使う。 */
export const RESUME_RADIUS_METERS = 500;

function parse(raw: string | null | undefined): StoredSelection | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<StoredSelection> | null;
    if (!parsed || parsed.version !== 1) return null;
    if (typeof parsed.stationId !== 'string' || typeof parsed.directionId !== 'string') return null;
    if (typeof parsed.lat !== 'number' || typeof parsed.lng !== 'number') return null;
    return parsed as StoredSelection;
  } catch {
    return null;
  }
}

export async function loadSelection(host: HostStorage | null): Promise<StoredSelection | null> {
  let web: StoredSelection | null = null;
  try {
    web = parse(localStorage.getItem(KEY));
  } catch {
    web = null;
  }

  let hostSaved: StoredSelection | null = null;
  if (host) {
    try {
      hostSaved = parse(await host.get(KEY));
    } catch {
      hostSaved = null;
    }
  }

  if (web && hostSaved) return web.savedAt >= hostSaved.savedAt ? web : hostSaved;
  return web ?? hostSaved;
}

export async function saveSelection(
  selection: Omit<StoredSelection, 'version' | 'savedAt'>,
  host: HostStorage | null,
): Promise<void> {
  const payload: StoredSelection = { ...selection, version: 1, savedAt: Date.now() };
  const raw = JSON.stringify(payload);
  try {
    localStorage.setItem(KEY, raw);
  } catch {
    // 書けなくても動作は続ける
  }
  if (host) {
    try {
      await host.set(KEY, raw);
    } catch {
      // 同上
    }
  }
}
