/**
 * 駅選択から次発取得までの実行時ロジック。
 * G2 のプラグイン層も CLI もここを呼ぶ。描画とは独立させてある。
 */

import { OdptClient } from '../odpt/client.js';
import type { OdptStationTimetable } from '../odpt/types.js';
import { calendarFor, toJstParts } from './calendar.js';
import { findNextDepartures, type Departure } from './departures.js';
import { formatDistance, nearest, type LatLng } from './geo.js';
import { groupStations, type MasterDirection, type MasterStation, type StationGroup, type StationMaster } from './master.js';

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
}

export class TokyoJihatsuService {
  private readonly timetableCache = new Map<string, OdptStationTimetable>();
  private readonly stationNames: Map<string, string>;

  constructor(
    private readonly master: StationMaster,
    private readonly client: OdptClient,
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
    options: { limit?: number; maxDistanceMeters?: number } = {},
  ): NearbyStation[] {
    const groups = groupStations(this.master.stations);
    return nearest(location, groups, options).map(({ item, distanceMeters }) => ({
      group: item,
      distanceMeters,
      distanceLabel: formatDistance(distanceMeters),
    }));
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
  findGroupsByName(query: string): StationGroup[] {
    return groupStations(this.master.stations).filter((group) => group.name.includes(query));
  }

  /** 次発・次々発を取る。時刻表はカレンダー種別ごとにキャッシュする。 */
  async countdown(
    station: MasterStation,
    direction: MasterDirection,
    options: { now?: Date; count?: number } = {},
  ): Promise<CountdownSnapshot> {
    const now = options.now ?? new Date();
    const today = toJstParts(now);
    const calendarReason = calendarFor(today).reason;

    // 昨日・今日・明日で必要になりうるカレンダー種別の時刻表をまとめて用意する。
    const ids = [...new Set(Object.values(direction.timetables).filter(Boolean))] as string[];
    const timetables = await this.loadTimetables(ids);

    const departures = findNextDepartures(timetables, {
      now,
      count: options.count ?? 3,
      resolveLabel: (id) => this.stationNames.get(id),
    });

    return {
      station,
      direction,
      departures,
      calendarReason,
      empty: departures.length === 0,
    };
  }

  private async loadTimetables(ids: string[]): Promise<OdptStationTimetable[]> {
    const missing = ids.filter((id) => !this.timetableCache.has(id));
    if (missing.length > 0) {
      const fetched = await this.client.stationTimetablesById(missing);
      for (const timetable of fetched) {
        this.timetableCache.set(timetable['owl:sameAs'], timetable);
      }
    }
    return ids
      .map((id) => this.timetableCache.get(id))
      .filter((t): t is OdptStationTimetable => t !== undefined);
  }
}
