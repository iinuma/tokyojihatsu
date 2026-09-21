/**
 * カレンダー種別の判定。
 *
 * ODPT の時刻表は `odpt.Calendar:Weekday` / `odpt.Calendar:SaturdayHoliday` に
 * 分かれているが、「今日がどちらか」の対応は API から提供されない。
 * そのため祝日判定は自前で持つ（Notion 要件「祝日判定は自前で持つ必要がある」）。
 *
 * 祝日は内閣府告示の規則をそのまま実装する。テーブルを抱えないので
 * 年をまたいでもメンテナンスが要らない。春分・秋分は 1980–2099 で有効な近似式。
 */

import type { CalendarId } from '../odpt/types.js';

/** JST 固定の年月日。Date のローカル TZ に依存させない。 */
export interface JstDate {
  year: number;
  month: number; // 1-12
  day: number; // 1-31
}

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** ある時刻の JST での年月日・時分秒を取り出す。 */
export function toJstParts(date: Date): JstDate & { hour: number; minute: number; second: number } {
  const shifted = new Date(date.getTime() + JST_OFFSET_MS);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
    second: shifted.getUTCSeconds(),
  };
}

/** 0=日曜 … 6=土曜。 */
export function dayOfWeek(d: JstDate): number {
  return new Date(Date.UTC(d.year, d.month - 1, d.day)).getUTCDay();
}

export function addDays(d: JstDate, days: number): JstDate {
  const shifted = new Date(Date.UTC(d.year, d.month - 1, d.day + days));
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}

export function formatJstDate(d: JstDate): string {
  return `${d.year}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}`;
}

function sameDate(a: JstDate, b: JstDate): boolean {
  return a.year === b.year && a.month === b.month && a.day === b.day;
}

/** その月の第 n 月曜日。 */
function nthMonday(year: number, month: number, nth: number): number {
  const firstDow = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  const offsetToMonday = (8 - firstDow) % 7; // 1日が月曜なら 0
  return 1 + offsetToMonday + (nth - 1) * 7;
}

/** 春分日（1980–2099 で有効な近似式）。 */
function vernalEquinoxDay(year: number): number {
  return Math.floor(20.8431 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4));
}

/** 秋分日（1980–2099 で有効な近似式）。 */
function autumnalEquinoxDay(year: number): number {
  return Math.floor(23.2488 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4));
}

/** その年の「国民の祝日」本体（振替休日・国民の休日を含まない）。 */
function statutoryHolidays(year: number): { date: JstDate; name: string }[] {
  const at = (month: number, day: number, name: string) => ({
    date: { year, month, day },
    name,
  });

  const holidays = [
    at(1, 1, '元日'),
    at(1, nthMonday(year, 1, 2), '成人の日'),
    at(2, 11, '建国記念の日'),
    at(2, 23, '天皇誕生日'),
    at(3, vernalEquinoxDay(year), '春分の日'),
    at(4, 29, '昭和の日'),
    at(5, 3, '憲法記念日'),
    at(5, 4, 'みどりの日'),
    at(5, 5, 'こどもの日'),
    at(7, nthMonday(year, 7, 3), '海の日'),
    at(8, 11, '山の日'),
    at(9, nthMonday(year, 9, 3), '敬老の日'),
    at(9, autumnalEquinoxDay(year), '秋分の日'),
    at(10, nthMonday(year, 10, 2), 'スポーツの日'),
    at(11, 3, '文化の日'),
    at(11, 23, '勤労感謝の日'),
  ];

  return holidays.sort(
    (a, b) => a.date.month - b.date.month || a.date.day - b.date.day,
  );
}

/**
 * 振替休日と国民の休日を足した、その年の休日一覧。
 * - 振替休日: 祝日が日曜なら、その後の最初の平日
 * - 国民の休日: 祝日に挟まれた平日（敬老の日と秋分の日の間など）
 */
function allHolidays(year: number): { date: JstDate; name: string }[] {
  const base = statutoryHolidays(year);
  const result = [...base];
  const isBaseHoliday = (d: JstDate) => base.some((h) => sameDate(h.date, d));

  // 振替休日
  for (const holiday of base) {
    if (dayOfWeek(holiday.date) !== 0) continue;
    let candidate = addDays(holiday.date, 1);
    while (isBaseHoliday(candidate)) {
      candidate = addDays(candidate, 1);
    }
    result.push({ date: candidate, name: '振替休日' });
  }

  // 国民の休日（祝日 → 平日 1 日 → 祝日）
  for (let i = 0; i < base.length - 1; i += 1) {
    const current = base[i];
    const next = base[i + 1];
    if (!current || !next) continue;
    const between = addDays(current.date, 1);
    if (!sameDate(between, addDays(next.date, -1))) continue;
    if (dayOfWeek(between) === 0) continue; // 日曜は振替休日側で扱う
    if (isBaseHoliday(between)) continue;
    result.push({ date: between, name: '国民の休日' });
  }

  return result;
}

const holidayCache = new Map<number, { date: JstDate; name: string }[]>();

export function holidayName(d: JstDate): string | null {
  let holidays = holidayCache.get(d.year);
  if (!holidays) {
    holidays = allHolidays(d.year);
    holidayCache.set(d.year, holidays);
  }
  return holidays.find((h) => sameDate(h.date, d))?.name ?? null;
}

export function isHoliday(d: JstDate): boolean {
  return holidayName(d) !== null;
}

export interface CalendarDecision {
  /**
   * その日に適用するカレンダー種別の候補（優先順）。
   * 都電荒川線のように Saturday / Holiday を別建てで持つ路線があるため、
   * 単一の値ではなく候補リストを返し、実在するものを時刻表側で選ぶ。
   */
  candidates: CalendarId[];
  /** 判定理由。表示やデバッグ用（「平日」「土曜」「敬老の日」など）。 */
  reason: string;
}

/**
 * 日付 → ODPT のカレンダー種別（優先順の候補）。
 *
 * 注意: 年末年始（12/29–1/3）に土休日ダイヤを走らせる事業者があるが、
 * 扱いは事業者ごとに異なり ODPT からは判別できない。ここでは平日として扱う。
 */
export function calendarFor(d: JstDate): CalendarDecision {
  const name = holidayName(d);
  if (name) {
    return { candidates: ['odpt.Calendar:Holiday', 'odpt.Calendar:SaturdayHoliday'], reason: name };
  }

  const dow = dayOfWeek(d);
  if (dow === 0) {
    return { candidates: ['odpt.Calendar:Holiday', 'odpt.Calendar:SaturdayHoliday'], reason: '日曜' };
  }
  if (dow === 6) {
    return { candidates: ['odpt.Calendar:Saturday', 'odpt.Calendar:SaturdayHoliday'], reason: '土曜' };
  }
  return { candidates: ['odpt.Calendar:Weekday'], reason: '平日' };
}
