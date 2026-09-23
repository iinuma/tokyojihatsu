/**
 * 次発・次々発の算出。
 *
 * ODPT の駅時刻表で注意すべき点（実測で確認）:
 * - `odpt:departureTime` は分単位の HH:MM。秒はない。
 * - 終電は 25:00 ではなく `00:07` `00:21` のように **0 時台で表記** される。
 *   配列は運行順なので、前の要素より時刻が小さくなったところが日跨ぎ。
 *   時刻の文字列だけでソートすると終電が始発より前に来るので必ず正規化する。
 */

import type { CalendarId, OdptStationTimetable, OdptTimetableObject } from '../odpt/types.js';
import { addDays, calendarFor, formatJstDate, toJstParts, type JstDate } from './calendar.js';

export interface Departure {
  /** 発車時刻（その分の 00 秒を基準とする絶対時刻）。 */
  at: Date;
  /** 時刻表上の表記そのまま（例 "00:21"）。 */
  scheduledTime: string;
  /** 画面表示用の時刻（日跨ぎを 24 時超えで表す。例 "24:21"）。 */
  displayTime: string;
  trainType?: string;
  destination?: string;
  trainNumber?: string;
  isLast: boolean;
  /** この発車が属するサービス日。 */
  serviceDate: string;
  calendar: CalendarId;
  /**
   * 公表されている遅延（秒）。0 は定刻、undefined は遅延情報が無い路線。
   * `at` にはこの遅延が加算済み。
   */
  delaySeconds?: number;
}

export interface DepartureLookupOptions {
  now: Date;
  /** 取得する本数。既定 3（次発・次々発・予備）。 */
  count?: number;
  /** ID → 表示名の変換（行先駅名・列車種別）。無ければ ID のまま返す。 */
  resolveLabel?: (id: string) => string | undefined;
}

/**
 * 時刻表配列を運行順に走査し、日跨ぎ分を加算した「サービス日開始からの分」を付ける。
 */
function withDayOffset(
  objects: readonly OdptTimetableObject[],
): { object: OdptTimetableObject; minutes: number }[] {
  const result: { object: OdptTimetableObject; minutes: number }[] = [];
  let previousMinutes = -1;
  let dayOffset = 0;

  for (const object of objects) {
    const parsed = parseHhMm(object['odpt:departureTime']);
    if (parsed === null) continue;

    if (parsed < previousMinutes) dayOffset += 1;
    previousMinutes = parsed;

    result.push({ object, minutes: parsed + dayOffset * 1440 });
  }

  return result;
}

function parseHhMm(value: string | undefined): number | null {
  if (!value) return null;
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isFinite(hour) || !Number.isFinite(minute) || minute > 59) return null;
  return hour * 60 + minute;
}

/** サービス日の 0:00 (JST) を絶対時刻で返す。 */
function serviceDayStart(date: JstDate): Date {
  return new Date(Date.UTC(date.year, date.month - 1, date.day, -9, 0, 0, 0));
}

function formatDisplayTime(minutes: number): string {
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

/**
 * 指定の時刻表群から、`now` 以降の発車を近い順に返す。
 *
 * `timetables` には同じ駅・同じ方面の全カレンダー分（平日・土休日）を渡す。
 * 昨日・今日・明日の 3 サービス日を展開して評価するので、終電後の始発、
 * 深夜 0 時台に前日ダイヤが続いている状態、平日→土曜の切り替わりが自然に扱える。
 */
export function findNextDepartures(
  timetables: readonly OdptStationTimetable[],
  options: DepartureLookupOptions,
): Departure[] {
  const { now, count = 3, resolveLabel } = options;
  const today = toJstParts(now);
  const serviceDates: JstDate[] = [
    addDays(today, -1),
    { year: today.year, month: today.month, day: today.day },
    addDays(today, 1),
  ];

  const candidates: Departure[] = [];

  for (const serviceDate of serviceDates) {
    const { candidates: calendarCandidates } = calendarFor(serviceDate);
    // 渡された時刻表に実在する種別のうち、最も優先度の高いものを採用する。
    const calendar = calendarCandidates.find((candidate) =>
      timetables.some((timetable) => timetable['odpt:calendar'] === candidate),
    );
    if (!calendar) continue;

    const dayStart = serviceDayStart(serviceDate);

    for (const timetable of timetables) {
      if (timetable['odpt:calendar'] !== calendar) continue;

      for (const { object, minutes } of withDayOffset(timetable['odpt:stationTimetableObject'] ?? [])) {
        const at = new Date(dayStart.getTime() + minutes * 60_000);
        if (at.getTime() < now.getTime()) continue;

        candidates.push({
          at,
          scheduledTime: object['odpt:departureTime'],
          displayTime: formatDisplayTime(minutes),
          trainType: label(object['odpt:trainType'], resolveLabel),
          destination: label(object['odpt:destinationStation']?.[0], resolveLabel),
          trainNumber: object['odpt:trainNumber'],
          isLast: object['odpt:isLast'] === true,
          serviceDate: formatJstDate(serviceDate),
          calendar,
        });
      }
    }
  }

  return candidates
    .sort((a, b) => a.at.getTime() - b.at.getTime())
    .slice(0, count);
}

function label(
  id: string | undefined,
  resolveLabel: DepartureLookupOptions['resolveLabel'],
): string | undefined {
  if (!id) return undefined;
  return resolveLabel?.(id) ?? id;
}

/**
 * 残り時間の表示文字列。
 * 1 時間以上は「1:02:30」、それ未満は「12:34」、1 分未間は「0:59」。
 */
export function formatCountdown(millisecondsRemaining: number): string {
  const totalSeconds = Math.max(0, Math.floor(millisecondsRemaining / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}
