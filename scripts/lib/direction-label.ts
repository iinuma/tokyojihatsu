/**
 * 方面ラベルが同じになってしまう駅を救う。
 *
 * ラベルは「平日時刻表の最頻行先」から作っている。ふつうの路線ならこれで
 * 一意になるが、**環状線では両方向とも同じ駅が最頻になる**。
 * 山手線はほぼ全列車が大崎を通るため、内回りも外回りも「大崎方面」になり、
 * 全 30 駅で方向が見分けられなくなっていた（都営大江戸線の都庁前も同じ）。
 *
 * そこで、同じ駅・同じ路線で label が衝突したときだけ、**その方向の隣の駅**を
 * ラベルにする。隣の駅は必ず方向ごとに違うので、確実に区別がつく。
 *
 * 隣の駅は `odpt:stationOrder` の並びと、路線が持つ
 * `odpt:ascendingRailDirection` / `odpt:descendingRailDirection` から引く。
 *
 * ⚠️ **内回り / 外回りの向きは推測してはいけない。** 山手線の stationOrder は
 * 大崎から始まり品川で終わる並びで、ascending が外回りだと宣言されている。
 * 列車時刻表（odpt:TrainTimetable）で実際の走行順を確かめたところ、
 * 外回りは「高輪ゲートウェイ → 品川 → 大崎」、内回りは「大崎 → 品川 →
 * 高輪ゲートウェイ → 田町」で、宣言どおりだった。つまり**品川で東京方面は内回り**。
 */

import type { OdptRailway } from '../../src/odpt/types.js';

export interface RailwayOrder {
  /** index が増える向きの方面 ID。 */
  ascending?: string;
  /** index が減る向きの方面 ID。 */
  descending?: string;
  /** index → 駅 ID */
  stationByIndex: Map<number, string>;
  /** 駅 ID → その駅が現れる index（環状線は始点が 2 回現れる） */
  indicesByStation: Map<string, number[]>;
}

export function buildRailwayOrder(railway: OdptRailway): RailwayOrder {
  const stationByIndex = new Map<number, string>();
  const indicesByStation = new Map<string, number[]>();

  for (const entry of railway['odpt:stationOrder'] ?? []) {
    const index = entry['odpt:index'];
    const station = entry['odpt:station'];
    if (typeof index !== 'number' || !station) continue;

    stationByIndex.set(index, station);
    const list = indicesByStation.get(station);
    if (list) list.push(index);
    else indicesByStation.set(station, [index]);
  }

  return {
    ascending: railway['odpt:ascendingRailDirection'],
    descending: railway['odpt:descendingRailDirection'],
    stationByIndex,
    indicesByStation,
  };
}

/**
 * その方向へ進んだとき、次に来る駅の ID。
 *
 * 環状線では始点の駅が並びの両端に現れる（山手線なら大崎が index 1 と 31）。
 * どちらの出現からでも隣が引けるよう、全部の index を試す。
 */
export function adjacentStation(
  order: RailwayOrder,
  stationId: string,
  directionId: string,
): string | undefined {
  const step =
    directionId === order.ascending ? 1 : directionId === order.descending ? -1 : 0;
  if (step === 0) return undefined;

  for (const index of order.indicesByStation.get(stationId) ?? []) {
    const neighbour = order.stationByIndex.get(index + step);
    // 自分自身が返ることはないはずだが、壊れたデータで無限に同じ駅を
    // 指さないよう念のため弾く。
    if (neighbour && neighbour !== stationId) return neighbour;
  }
  return undefined;
}

export interface LabelledDirection {
  id: string;
  title: string;
  label: string;
}

/**
 * 同じラベルになっている方面を、隣の駅のラベルに差し替える。
 *
 * 衝突していないものには触らない。隣の駅が引けなければ ODPT の方面名
 * （「内回り」「外回り」など）に落とす。少なくとも区別はつく。
 */
export function disambiguate<T extends LabelledDirection>(
  directions: T[],
  options: {
    order: RailwayOrder | undefined;
    stationId: string;
    nameOf: (stationId: string) => string | undefined;
  },
): T[] {
  const counts = new Map<string, number>();
  for (const direction of directions) {
    counts.set(direction.label, (counts.get(direction.label) ?? 0) + 1);
  }

  return directions.map((direction) => {
    if ((counts.get(direction.label) ?? 0) < 2) return direction;

    const neighbour = options.order
      ? adjacentStation(options.order, options.stationId, direction.id)
      : undefined;
    const name = neighbour ? options.nameOf(neighbour) : undefined;

    return { ...direction, label: name ? `${name}方面` : direction.title };
  });
}
