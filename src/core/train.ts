/**
 * 走行中の列車が、いまどこまで進んでいるかを出す。
 *
 * ODPT の列車位置（`odpt:Train`）は「どの駅間にいるか」しか持たない。
 * 区間のどこまで進んだかは入っていないので、**空間ではなく時間で測る**。
 *
 *   前の駅を出た予定時刻 ──●── 次の駅に着く予定時刻
 *                        いまの時刻
 *
 * 時刻は列車時刻表（`odpt:TrainTimetable`）から引く。列車番号で照合すると
 * その列車の全駅の着発時刻が取れる。遅れているぶんは `odpt:delay`（秒）を
 * 足して補正する。**自前で速度を推測しているのではなく、公表されている
 * 予定時刻と遅延を合成しているだけ**である点が大事。
 *
 * 動的データなので開発者ガイドライン 2.1 が効く。`dct:valid` を過ぎたものは
 * 使わず、`dc:date`（生成時刻）を画面に出す必要がある。
 */

import type { OdptTrain, OdptTrainTimetable, OdptTrainTimetableObject } from '../odpt/types.js';

/** 列車がいまどの区間のどこにいるか。 */
export interface TrainProgress {
  trainNumber: string;
  /** 直前に出た駅。停車中ならその駅。 */
  fromStation: string;
  /** 次に着く駅。終着に着いていれば null。 */
  toStation: string | null;
  /** 駅に停車中か（`odpt:toStation` が空のとき）。 */
  stopped: boolean;
  /** 区間の進み具合。0 が出発、1 が到着。停車中は 0。 */
  progress: number;
  /** 前の駅の発車予定時刻。時刻表に無ければ null。 */
  departureAt: Date | null;
  /** 次の駅の到着予定時刻。 */
  arrivalAt: Date | null;
  /** 遅延を足した到着見込み。 */
  estimatedArrivalAt: Date | null;
  /** 公表されている遅延（秒）。 */
  delaySeconds: number;
  /** データが作られた時刻。画面に出す義務がある。 */
  generatedAt: Date | null;
  /** このデータが使える期限。 */
  validUntil: Date | null;
  /** 期限を過ぎている。表示してはいけない。 */
  expired: boolean;
}

/** `odpt.Station:Toei.Oedo.Roppongi` → `Roppongi` */
export function stationKey(id: string | null | undefined): string | null {
  if (!id) return null;
  const last = id.slice(id.lastIndexOf('.') + 1);
  return last.length > 0 ? last : null;
}

/** "06:50" を、その日の絶対時刻にする。JST 固定。 */
function toAbsolute(hhmm: string | undefined, base: Date): Date | null {
  if (!hhmm) return null;
  const match = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!match) return null;

  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;

  // 基準日の JST での年月日を取り、そこに時刻を載せる。
  const jst = new Date(base.getTime() + 9 * 3600_000);
  const year = jst.getUTCFullYear();
  const month = jst.getUTCMonth();
  const day = jst.getUTCDate();

  let at = new Date(Date.UTC(year, month, day, hour - 9, minute, 0, 0));

  // 24 時をまたぐ運行では、基準時刻から大きく離れることがある。
  // 半日以上ずれていたら日付をずらして近いほうを採る。
  const half = 12 * 3600_000;
  if (at.getTime() - base.getTime() > half) at = new Date(at.getTime() - 24 * 3600_000);
  else if (base.getTime() - at.getTime() > half) at = new Date(at.getTime() + 24 * 3600_000);

  return at;
}

function parseIso(value: string | undefined): Date | null {
  if (!value) return null;
  const at = new Date(value);
  return Number.isNaN(at.getTime()) ? null : at;
}

/**
 * 列車時刻表から、指定した駅の着発を探す。
 *
 * 同じ駅を 2 度通る運行（環状線など）もあるので、見つかった候補のうち
 * 基準時刻にいちばん近いものを採る。
 */
function findStop(
  timetable: OdptTrainTimetable,
  station: string,
  base: Date,
): OdptTrainTimetableObject | null {
  const key = stationKey(station);
  if (!key) return null;

  const matches = (timetable['odpt:trainTimetableObject'] ?? []).filter((stop) => {
    const departure = stationKey(stop['odpt:departureStation']);
    const arrival = stationKey(stop['odpt:arrivalStation']);
    return departure === key || arrival === key;
  });

  if (matches.length <= 1) return matches[0] ?? null;

  let best: OdptTrainTimetableObject | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const stop of matches) {
    const at = toAbsolute(stop['odpt:departureTime'] ?? stop['odpt:arrivalTime'], base);
    if (!at) continue;
    const distance = Math.abs(at.getTime() - base.getTime());
    if (distance < bestDistance) {
      best = stop;
      bestDistance = distance;
    }
  }
  return best ?? matches[0] ?? null;
}

/** 時刻表の並びで、指定した駅の次に来る停車を返す。 */
function findNextStop(
  timetable: OdptTrainTimetable,
  station: string,
): OdptTrainTimetableObject | null {
  const key = stationKey(station);
  if (!key) return null;

  const stops = timetable['odpt:trainTimetableObject'] ?? [];
  const index = stops.findIndex((stop) => {
    const departure = stationKey(stop['odpt:departureStation']);
    const arrival = stationKey(stop['odpt:arrivalStation']);
    return departure === key || arrival === key;
  });
  if (index < 0) return null;
  return stops[index + 1] ?? null;
}

export interface ProgressOptions {
  now?: Date;
}

/**
 * 列車位置と時刻表を突き合わせて進み具合を出す。
 * 時刻表が見つからなければ、位置と遅延だけを返す（進捗は 0）。
 */
export function trainProgress(
  train: OdptTrain,
  timetable: OdptTrainTimetable | null,
  options: ProgressOptions = {},
): TrainProgress {
  const now = options.now ?? new Date();
  const generatedAt = parseIso(train['dc:date']);
  const validUntil = parseIso(train['dct:valid']);
  const delaySeconds = train['odpt:delay'] ?? 0;

  const from = train['odpt:fromStation'] ?? '';
  const to = train['odpt:toStation'] ?? null;
  const stopped = to === null;

  const base: TrainProgress = {
    trainNumber: train['odpt:trainNumber'] ?? '',
    fromStation: from,
    toStation: to,
    stopped,
    progress: 0,
    departureAt: null,
    arrivalAt: null,
    estimatedArrivalAt: null,
    delaySeconds,
    generatedAt,
    validUntil,
    expired: validUntil !== null && now.getTime() > validUntil.getTime(),
  };

  if (!timetable) return base;

  const reference = generatedAt ?? now;
  const fromStop = findStop(timetable, from, reference);

  // 停車中は「次の停車」が向かう先になる。走行中は toStation を直接引く。
  const toStop = stopped
    ? (fromStop ? findNextStop(timetable, from) : null)
    : findStop(timetable, to ?? '', reference);

  const departureAt = toAbsolute(fromStop?.['odpt:departureTime'], reference);
  const arrivalAt = toAbsolute(
    toStop?.['odpt:arrivalTime'] ?? toStop?.['odpt:departureTime'],
    reference,
  );

  const estimatedArrivalAt = arrivalAt
    ? new Date(arrivalAt.getTime() + delaySeconds * 1000)
    : null;

  let progress = 0;
  if (!stopped && departureAt && arrivalAt) {
    const span = arrivalAt.getTime() - departureAt.getTime();
    if (span > 0) {
      // 遅延ぶんを足した「いまの位置」を、予定の時間軸に写して測る。
      const elapsed = now.getTime() - delaySeconds * 1000 - departureAt.getTime();
      progress = Math.max(0, Math.min(1, elapsed / span));
    }
  }

  return {
    ...base,
    progress,
    departureAt,
    arrivalAt,
    estimatedArrivalAt,
  };
}

/** 遅延の表示。定刻なら null を返す（わざわざ「0分」と出さない）。 */
export function formatDelay(seconds: number): string | null {
  if (seconds <= 0) return null;
  const minutes = Math.round(seconds / 60);
  if (minutes < 1) return '約1分遅れ';
  return `${minutes}分遅れ`;
}

/**
 * 進み具合を横棒で描く。G2 は固定フォントなので、罫線素片を並べて表す。
 * 絵文字は使えない。
 */
export function progressBar(progress: number, width = 20): string {
  const filled = Math.max(0, Math.min(width, Math.round(progress * width)));
  if (filled >= width) return '─'.repeat(width - 1) + '●';
  return '─'.repeat(filled) + '●' + '─'.repeat(width - filled - 1);
}


/**
 * 駅時刻表の発車に、いまの遅延を重ねるための索引。
 *
 * 駅時刻表の発車は列車番号を持ち、列車位置も列車番号を持つ。
 * そこで突き合わせる。位置データを出していない事業者（東京メトロなど）では
 * 索引が空になり、遅延なしとして扱われる。
 */
export interface DelayIndex {
  /** 列車番号 → 遅延（秒） */
  byTrainNumber: Map<string, number>;
  /** このデータが作られた時刻。画面に出す義務がある（ガイドライン 2.1）。 */
  generatedAt: Date | null;
  /** 使える期限。過ぎたら遅延表示をやめる。 */
  validUntil: Date | null;
}

export function buildDelayIndex(trains: readonly OdptTrain[]): DelayIndex {
  const byTrainNumber = new Map<string, number>();
  let generatedAt: Date | null = null;
  let validUntil: Date | null = null;

  for (const train of trains) {
    const number = train['odpt:trainNumber'];
    if (number) byTrainNumber.set(number, train['odpt:delay'] ?? 0);

    // 生成時刻は最も古いもの、期限は最も早いものを採る。
    // 一部でも古ければ、その塊全体を古いものとして扱う。
    const date = parseIso(train['dc:date']);
    if (date && (!generatedAt || date < generatedAt)) generatedAt = date;

    const valid = parseIso(train['dct:valid']);
    if (valid && (!validUntil || valid < validUntil)) validUntil = valid;
  }

  return { byTrainNumber, generatedAt, validUntil };
}

/** その索引がいま使えるか。期限切れなら遅延を表示してはいけない。 */
export function isDelayIndexUsable(index: DelayIndex, now = new Date()): boolean {
  if (index.byTrainNumber.size === 0) return false;
  if (!index.validUntil) return false;
  return now.getTime() <= index.validUntil.getTime();
}

/** 列車番号に対する遅延（秒）。分からなければ null。 */
export function delayFor(
  index: DelayIndex,
  trainNumber: string | undefined,
  now = new Date(),
): number | null {
  if (!trainNumber) return null;
  if (!isDelayIndexUsable(index, now)) return null;
  return index.byTrainNumber.get(trainNumber) ?? null;
}
