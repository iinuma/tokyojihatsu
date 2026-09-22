/** 駅マスタの型。`scripts/build-master.ts` が生成し、実行時はこれだけを読む。 */

import type { CalendarId } from '../odpt/types.js';

export interface MasterDirection {
  /** odpt:RailDirection の ID。 */
  id: string;
  /** ODPT が持つ方向名（「外回り」「北行」など。抽象的で分かりにくい）。 */
  title: string;
  /** 利用者向けの方面ラベル（「光が丘方面」）。最頻行先から生成する。 */
  label: string;
  /** カレンダー種別 → 時刻表 ID。実行時はこの ID で 1 レコードだけ引く。 */
  timetables: Partial<Record<CalendarId, string>>;
}

/**
 * その駅のデータがどのライセンスで提供されているか。
 * challenge は期限付きで、過ぎたら候補から外す。
 */
export type DataLicense = 'basic' | 'challenge';

export interface MasterStation {
  id: string;
  name: string;
  lat: number;
  lng: number;
  operator: string;
  operatorName: string;
  railway: string;
  railwayName: string;
  stationCode?: string;
  license: DataLicense;
  directions: MasterDirection[];
}

export interface StationMaster {
  generatedAt: string;
  /** ODPT のデータ取得日時。ライセンス上、画面から辿れる場所に表示する必要がある。 */
  sourceDate: string;
  /**
   * チャレンジ限定データの利用期限（YYYY-MM-DD）。
   * この日を過ぎたら license:'challenge' の駅を候補から外す。
   * 期限後もアプリは壊れず、対応範囲が基本ライセンスの分だけに戻る。
   */
  challengeExpiresAt?: string;
  stationCount: number;
  stations: MasterStation[];
  /**
   * 表示ラベル辞書。ODPT の ID → 日本語。
   * 行先には直通先の他社線の駅が出るので、7 事業者の駅だけでは足りない。
   */
  labels: Record<string, string>;
}

/**
 * 同一駅名・同一場所にある別路線のホームをまとめた「駅」の単位。
 * 近傍駅リストは路線ごとではなく駅ごとに出したいので使う。
 */
export interface StationGroup {
  name: string;
  lat: number;
  lng: number;
  /** この駅名で乗れる路線（別事業者を含む）。 */
  entries: MasterStation[];
}

const GROUPING_RADIUS_METERS = 400;

/**
 * チャレンジ限定データが使える期間内か。
 * 期限当日までは使える扱いにする。
 */
export function isChallengeUsable(master: StationMaster, now = new Date()): boolean {
  if (!master.challengeExpiresAt) return false;
  const [year, month, day] = master.challengeExpiresAt.split('-').map(Number);
  if (!year || !month || !day) return false;
  // 期限日の終わり（JST）まで有効とする。
  const deadline = Date.UTC(year, month - 1, day + 1, -9, 0, 0, 0);
  return now.getTime() < deadline;
}

/** いま候補に出してよい駅だけを返す。 */
export function usableStations(master: StationMaster, now = new Date()): MasterStation[] {
  if (isChallengeUsable(master, now)) return master.stations;
  return master.stations.filter((station) => station.license !== 'challenge');
}

/** 駅名と位置が近いものを 1 つの駅としてまとめる。 */
export function groupStations(stations: readonly MasterStation[]): StationGroup[] {
  const byName = new Map<string, MasterStation[]>();
  for (const station of stations) {
    const bucket = byName.get(station.name);
    if (bucket) bucket.push(station);
    else byName.set(station.name, [station]);
  }

  const groups: StationGroup[] = [];
  for (const [name, members] of byName) {
    // 同名でも離れている駅（例: 別事業者の同名駅）は分ける。
    const clusters: MasterStation[][] = [];
    for (const member of members) {
      const cluster = clusters.find((c) =>
        c.some((existing) => roughDistance(existing, member) <= GROUPING_RADIUS_METERS),
      );
      if (cluster) cluster.push(member);
      else clusters.push([member]);
    }

    for (const cluster of clusters) {
      groups.push({
        name,
        lat: average(cluster.map((s) => s.lat)),
        lng: average(cluster.map((s) => s.lng)),
        entries: cluster,
      });
    }
  }

  return groups;
}

function roughDistance(a: MasterStation, b: MasterStation): number {
  const dLat = (a.lat - b.lat) * 111_320;
  const dLng = (a.lng - b.lng) * 111_320 * Math.cos((a.lat * Math.PI) / 180);
  return Math.hypot(dLat, dLng);
}

function average(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}
