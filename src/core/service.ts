/**
 * 駅選択から次発取得までの実行時ロジック。
 * G2 のプラグイン層も CLI もここを呼ぶ。描画とは独立させてある。
 */

import { OdptClient } from '../odpt/client.js';
import type { OdptStationTimetable } from '../odpt/types.js';
import { calendarFor, toJstParts } from './calendar.js';
import { buildDelayIndex, delayFor, type DelayIndex } from './train.js';
import { findNextDepartures, type Departure } from './departures.js';
import { formatDistance, nearest, type LatLng } from './geo.js';
import {
  groupStations,
  isChallengeUsable,
  usableStations,
  type MasterDirection,
  type MasterStation,
  type StationGroup,
  type StationMaster,
} from './master.js';

export interface NearbyStation {
  group: StationGroup;
  distanceMeters: number;
  distanceLabel: string;
}

/** 駅 × 方面の 1 候補。G2 の List に 1 行として出す単位。 */
export interface DirectionChoice {
  station: MasterStation;
  direction: MasterDirection;
  /** 「月島　大江戸線・光が丘方面」 */
  label: string;
}

export interface CountdownSnapshot {
  station: MasterStation;
  direction: MasterDirection;
  departures: Departure[];
  /** 判定に使ったカレンダー種別の理由（「平日」「敬老の日」など）。 */
  calendarReason: string;
  /** 次発が無い（終電後で翌日の始発も引けない等）。 */
  empty: boolean;
  /**
   * 遅延情報が作られた時刻。
   * 動的データなので、使うなら画面に出す義務がある（ガイドライン 2.1）。
   * 遅延が取れなかった路線では null。
   */
  delayGeneratedAt: Date | null;
}

export class TokyoJihatsuService {
  private readonly timetableCache = new Map<string, OdptStationTimetable>();
  /** 路線ごとの遅延。短命なので取得時刻とともに持つ。 */
  private readonly delayCache = new Map<string, { index: DelayIndex; fetchedAt: number }>();
  private readonly stationNames: Map<string, string>;
  /** 駅のグループ化は 1800 駅超を走査するので、期限の判定結果ごとに覚えておく。 */
  private groupCache: { challengeUsable: boolean; groups: StationGroup[] } | null = null;

  constructor(
    private readonly master: StationMaster,
    private readonly client: OdptClient,
    /**
     * チャレンジ限定ライセンスのデータを引く口。
     * エンドポイントもトークンも別なので分ける。無ければ基本の口を使う
     * （CLI のように直接 ODPT を叩く場合は同じ口で足りる）。
     */
    private readonly challengeClient: OdptClient | null = null,
  ) {
    // マスタの labels（行先・列車種別）に、7 事業者の駅名を足したものを引く辞書にする。
    this.stationNames = new Map(Object.entries(master.labels ?? {}));
    for (const station of master.stations) {
      if (!this.stationNames.has(station.id)) this.stationNames.set(station.id, station.name);
    }
  }

  /** 現在地に近い駅（同名・近接の路線はまとめる）。 */
  nearbyStations(
    location: LatLng,
    options: { limit?: number; maxDistanceMeters?: number; now?: Date } = {},
  ): NearbyStation[] {
    return nearest(location, this.groups(options.now), options).map(
      ({ item, distanceMeters }) => ({
        group: item,
        distanceMeters,
        distanceLabel: formatDistance(distanceMeters),
      }),
    );
  }

  /**
   * いま候補に出してよい駅のグループ。
   *
   * チャレンジ限定ライセンスのデータは 2027-03-12 で許諾が切れる。
   * 期限を過ぎたら該当駅を落とすので、アプリは壊れずに対応範囲が
   * 基本ライセンスのぶんへ戻るだけになる。
   */
  private groups(now = new Date()): StationGroup[] {
    const challengeUsable = isChallengeUsable(this.master, now);
    if (this.groupCache?.challengeUsable === challengeUsable) return this.groupCache.groups;

    const groups = groupStations(usableStations(this.master, now));
    this.groupCache = { challengeUsable, groups };
    return groups;
  }

  /** ある駅グループで選べる「路線・方面」の一覧。 */
  directionChoices(group: StationGroup): DirectionChoice[] {
    const choices: DirectionChoice[] = [];
    for (const station of group.entries) {
      for (const direction of station.directions) {
        choices.push({
          station,
          direction,
          label: `${station.name}　${station.railwayName}・${direction.label}`,
        });
      }
    }
    return choices;
  }

  /** 駅名で引く（CLI 用。部分一致）。 */
  findGroupsByName(query: string, now?: Date): StationGroup[] {
    return this.groups(now).filter((group) => group.name.includes(query));
  }

  /** 次発・次々発を取る。時刻表はカレンダー種別ごとにキャッシュする。 */
  async countdown(
    station: MasterStation,
    direction: MasterDirection,
    options: { now?: Date; count?: number; withDelay?: boolean } = {},
  ): Promise<CountdownSnapshot> {
    const client =
      station.license === 'challenge' ? (this.challengeClient ?? this.client) : this.client;
    const now = options.now ?? new Date();
    const today = toJstParts(now);
    const calendarReason = calendarFor(today).reason;

    // 昨日・今日・明日で必要になりうるカレンダー種別の時刻表をまとめて用意する。
    const ids = [...new Set(Object.values(direction.timetables).filter(Boolean))] as string[];
    const timetables = await this.loadTimetables(ids, client);

    const departures = findNextDepartures(timetables, {
      now,
      count: options.count ?? 3,
      resolveLabel: (id) => this.stationNames.get(id),
    });

    // 遅延が取れる路線なら、発車ごとに重ねる。取れなくても時刻表どおりに出す。
    let delayGeneratedAt: Date | null = null;
    if (options.withDelay !== false) {
      const index = await this.delayIndex(station, client).catch(() => null);
      if (index) {
        for (const departure of departures) {
          const seconds = delayFor(index, departure.trainNumber, now);
          if (seconds !== null && seconds > 0) {
            departure.delaySeconds = seconds;
            departure.at = new Date(departure.at.getTime() + seconds * 1000);
          }
        }
        if (index.byTrainNumber.size > 0) delayGeneratedAt = index.generatedAt;
      }
    }

    return {
      station,
      direction,
      departures,
      calendarReason,
      empty: departures.length === 0,
      delayGeneratedAt,
    };
  }

  /**
   * 路線の遅延索引。
   *
   * 列車位置は 30 秒ごとに更新され、`dct:valid` は 5 分。
   * それより短い間隔で引いても意味がないので、取得から 30 秒は使い回す。
   */
  private async delayIndex(station: MasterStation, client: OdptClient): Promise<DelayIndex | null> {
    const railway = station.railway;
    const cached = this.delayCache.get(railway);
    if (cached && Date.now() - cached.fetchedAt < 30_000) return cached.index;

    const trains = await client.trainsByRailway(railway);
    const index = buildDelayIndex(trains);
    this.delayCache.set(railway, { index, fetchedAt: Date.now() });
    return index;
  }

  private async loadTimetables(
    ids: string[],
    client: OdptClient = this.client,
  ): Promise<OdptStationTimetable[]> {
    const missing = ids.filter((id) => !this.timetableCache.has(id));
    if (missing.length > 0) {
      const fetched = await client.stationTimetablesById(missing);
      for (const timetable of fetched) {
        this.timetableCache.set(timetable['owl:sameAs'], timetable);
      }
    }
    return ids
      .map((id) => this.timetableCache.get(id))
      .filter((t): t is OdptStationTimetable => t !== undefined);
  }
}
