/**
 * ODPT から駅マスタ（data/stations.json）を生成する。
 *
 * 取得元は 2 つある。
 * - 基本ライセンス（api.odpt.org）… 7 事業者。期限なし
 * - チャレンジ限定ライセンス（api-challenge.odpt.org）… JR東日本ほか 8 社。
 *   **2027-03-12 で許諾終了・データ削除が義務**（限定ライセンス第 13 条）
 *
 * 混ぜずに駅ごとへ出所を記録する。期限が来たら該当駅を候補から外すだけで済み、
 * アプリは壊れずに対応範囲が基本ライセンス分へ戻る。
 *
 * 時刻表の本体は含めない。含めるのは
 *   - 時刻表が実在する駅とその座標
 *   - 駅 × 方面 → 時刻表 ID
 *   - 利用者向けの方面ラベル（最頻行先から生成）
 * だけで、発車時刻は実行時に ID 指定で 1 レコードずつ引く。
 *
 * 実行: npm run build:master
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { OdptClient } from '../src/odpt/client.js';
import {
  CALENDAR_IDS,
  CHALLENGE_BASE_URL,
  CHALLENGE_EXPIRES_AT,
  CHALLENGE_OPERATORS,
  CHALLENGE_OPERATOR_TITLES,
  OPERATOR_TITLES,
  PER_RAILWAY_OPERATORS,
  TIMETABLE_OPERATORS,
  type CalendarId,
  type OdptStation,
  type OdptStationTimetable,
} from '../src/odpt/types.js';
import type {
  DataLicense,
  MasterDirection,
  MasterStation,
  StationMaster,
} from '../src/core/master.js';

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUTPUT_PATH = resolve(PROJECT_ROOT, 'data/stations.json');

/** データの取得元。エンドポイントもトークンも許諾の期限も違う。 */
interface Source {
  license: DataLicense;
  baseUrl?: string;
  token: string;
  operators: readonly string[];
  titles: Record<string, string>;
}

async function loadEnv(name: string): Promise<string> {
  const fromEnv = process.env[name];
  if (fromEnv) return fromEnv.trim();

  const envFile = await readFile(resolve(PROJECT_ROOT, '.env'), 'utf8').catch(() => '');
  const matches = [...envFile.matchAll(new RegExp(`^${name}=(.+)$`, 'gm'))];
  return matches.at(-1)?.[1]?.trim() ?? '';
}

function stationName(station: OdptStation): string {
  return station['odpt:stationTitle']?.ja ?? station['dc:title'] ?? station['owl:sameAs'];
}

/** 「光が丘方面」。行先が終着駅名と同じでも問題ないのでそのまま付ける。 */
function directionLabel(destinationName: string | undefined, fallback: string): string {
  if (!destinationName) return fallback;
  return `${destinationName}方面`;
}

/** 駅 × 方面ごとに集めるもの。 */
interface DirectionAccumulator {
  timetables: Partial<Record<CalendarId, string>>;
  destinationCounts: Map<string, number>;
}

async function main(): Promise<void> {
  const basicToken = await loadEnv('ODPT_TOKEN');
  if (!basicToken) {
    throw new Error('ODPT_TOKEN が見つからない。.env に設定するか環境変数で渡す。');
  }
  const challengeToken = await loadEnv('ODPT_CHALLENGE_TOKEN');

  const sources: Source[] = [
    {
      license: 'basic',
      token: basicToken,
      operators: TIMETABLE_OPERATORS,
      titles: OPERATOR_TITLES,
    },
  ];

  if (challengeToken) {
    sources.push({
      license: 'challenge',
      baseUrl: CHALLENGE_BASE_URL,
      token: challengeToken,
      operators: CHALLENGE_OPERATORS,
      titles: CHALLENGE_OPERATOR_TITLES,
    });
  } else {
    console.log('ODPT_CHALLENGE_TOKEN が無いので、基本ライセンスのぶんだけ作る');
  }

  // 表示に使う辞書は取得元をまたいで共有する。直通先の駅名がここで埋まる。
  const stationNames = new Map<string, string>();
  const railwayTitles = new Map<string, string>();
  const directionTitles = new Map<string, string>();
  const trainTypeTitles = new Map<string, string>();
  const usedDestinationIds = new Set<string>();
  const usedTrainTypeIds = new Set<string>();

  /** 駅 ID → 方面 ID → 集計 */
  const directionsByStation = new Map<string, Map<string, DirectionAccumulator>>();
  /** 駅 ID → その駅を提供している取得元 */
  const stationsById = new Map<string, { station: OdptStation; license: DataLicense }>();

  let sourceDate = '';

  for (const source of sources) {
    const client = new OdptClient({ consumerKey: source.token, baseUrl: source.baseUrl });
    const label = source.license === 'basic' ? '基本ライセンス' : 'チャレンジ限定';
    console.log(`\n── ${label} ──`);

    for (const direction of await client.railDirections()) {
      directionTitles.set(direction['owl:sameAs'], direction['dc:title'] ?? direction['owl:sameAs']);
    }

    for (const operator of source.operators) {
      const title = source.titles[operator] ?? operator;
      console.log(`${title}: 駅・路線を取得中…`);

      const [stations, railways] = await Promise.all([
        client.stations(operator),
        client.railways(operator),
      ]);

      for (const station of stations) {
        stationNames.set(station['owl:sameAs'], stationName(station));
        // 同じ駅が両方の取得元にあることはないが、先に入れたほうを優先する。
        if (!stationsById.has(station['owl:sameAs'])) {
          stationsById.set(station['owl:sameAs'], { station, license: source.license });
        }
      }
      for (const railway of railways) {
        railwayTitles.set(
          railway['owl:sameAs'],
          railway['odpt:railwayTitle']?.ja ?? railway['dc:title'] ?? railway['owl:sameAs'],
        );
      }

      for (const trainType of await client.trainTypes(operator).catch(() => [])) {
        const value = trainType['dc:title'];
        if (value) trainTypeTitles.set(trainType['owl:sameAs'], value);
      }

      // 事業者単位で引くと 1000 件で打ち切られる事業者は路線ごとに取る。
      const perRailway = PER_RAILWAY_OPERATORS.includes(operator);
      let timetables: OdptStationTimetable[] = [];

      if (perRailway) {
        console.log(`  ${railways.length} 路線を個別に取得中…（時刻表がない路線も多い）`);
        for (const railway of railways) {
          const part = await client
            .stationTimetablesByRailway(railway['owl:sameAs'])
            .catch(() => []);
          if (part.length > 0) {
            timetables.push(...part);
            console.log(`    ${railwayTitles.get(railway['owl:sameAs'])}: ${part.length} 件`);
          }
        }
      } else {
        timetables = await client.stationTimetablesByOperator(operator);
      }

      console.log(`  時刻表 ${timetables.length} レコード`);

      for (const timetable of timetables) {
        const stationId = timetable['odpt:station'];
        const directionId = timetable['odpt:railDirection'];
        const calendar = timetable['odpt:calendar'] as CalendarId | undefined;
        if (!stationId || !directionId || !calendar || !CALENDAR_IDS.includes(calendar)) continue;

        const issued = timetable['dc:date'] ?? '';
        if (issued > sourceDate) sourceDate = issued;

        let byDirection = directionsByStation.get(stationId);
        if (!byDirection) {
          byDirection = new Map();
          directionsByStation.set(stationId, byDirection);
        }

        let accumulator = byDirection.get(directionId);
        if (!accumulator) {
          accumulator = { timetables: {}, destinationCounts: new Map() };
          byDirection.set(directionId, accumulator);
        }

        accumulator.timetables[calendar] = timetable['owl:sameAs'];

        for (const object of timetable['odpt:stationTimetableObject'] ?? []) {
          const trainType = object['odpt:trainType'];
          if (trainType) usedTrainTypeIds.add(trainType);

          const destination = object['odpt:destinationStation']?.[0];
          if (!destination) continue;
          usedDestinationIds.add(destination);

          // 方面ラベルの元になる最頻行先は平日で決める。
          if (calendar === 'odpt.Calendar:Weekday') {
            accumulator.destinationCounts.set(
              destination,
              (accumulator.destinationCounts.get(destination) ?? 0) + 1,
            );
          }
        }
      }
    }

    // 行先・種別に出てくる事業者のうち、この取得元で拾えていないもの（直通先）を補う。
    const known = new Set(source.operators);
    const extras = new Set<string>();
    for (const id of [...usedDestinationIds, ...usedTrainTypeIds]) {
      const match = /^odpt\.(?:Station|TrainType):([^.]+)\./.exec(id);
      const operator = match?.[1] ? `odpt.Operator:${match[1]}` : undefined;
      if (!operator || known.has(operator)) continue;
      if (stationNames.has(id) || trainTypeTitles.has(id)) continue;
      extras.add(operator);
    }

    for (const operator of extras) {
      console.log(`直通先の表示名を取得中: ${operator}`);
      for (const station of await client.stations(operator).catch(() => [])) {
        if (!stationNames.has(station['owl:sameAs'])) {
          stationNames.set(station['owl:sameAs'], stationName(station));
        }
      }
      for (const trainType of await client.trainTypes(operator).catch(() => [])) {
        const value = trainType['dc:title'];
        if (value && !trainTypeTitles.has(trainType['owl:sameAs'])) {
          trainTypeTitles.set(trainType['owl:sameAs'], value);
        }
      }
    }
  }

  const labels: Record<string, string> = {};
  for (const id of usedDestinationIds) {
    const name = stationNames.get(id);
    if (name) labels[id] = name;
  }
  for (const id of usedTrainTypeIds) {
    const title = trainTypeTitles.get(id);
    if (title) labels[id] = title;
  }

  const masterStations: MasterStation[] = [];

  for (const [stationId, entry] of stationsById) {
    const byDirection = directionsByStation.get(stationId);
    if (!byDirection || byDirection.size === 0) continue; // 時刻表がない駅は候補に出さない

    const lat = entry.station['geo:lat'];
    const lng = entry.station['geo:long'];
    if (typeof lat !== 'number' || typeof lng !== 'number') {
      console.warn(`座標がないので除外: ${stationId}`);
      continue;
    }

    const directions: MasterDirection[] = [];
    for (const [directionId, accumulator] of byDirection) {
      const title = directionTitles.get(directionId) ?? directionId;
      const topDestination = [...accumulator.destinationCounts.entries()].sort(
        (a, b) => b[1] - a[1],
      )[0]?.[0];
      const destinationName = topDestination ? stationNames.get(topDestination) : undefined;

      directions.push({
        id: directionId,
        title,
        label: directionLabel(destinationName, title),
        timetables: accumulator.timetables,
      });
    }

    directions.sort((a, b) => a.label.localeCompare(b.label, 'ja'));

    const operator = entry.station['odpt:operator'];
    const operatorTitle =
      OPERATOR_TITLES[operator as keyof typeof OPERATOR_TITLES] ??
      CHALLENGE_OPERATOR_TITLES[operator as keyof typeof CHALLENGE_OPERATOR_TITLES] ??
      operator;

    masterStations.push({
      id: stationId,
      name: stationName(entry.station),
      lat,
      lng,
      operator,
      operatorName: operatorTitle,
      railway: entry.station['odpt:railway'],
      railwayName: railwayTitles.get(entry.station['odpt:railway']) ?? entry.station['odpt:railway'],
      stationCode: entry.station['odpt:stationCode'],
      license: entry.license,
      directions,
    });
  }

  masterStations.sort((a, b) => a.id.localeCompare(b.id));

  const master: StationMaster = {
    generatedAt: new Date().toISOString(),
    sourceDate,
    challengeExpiresAt: challengeToken ? CHALLENGE_EXPIRES_AT : undefined,
    stationCount: masterStations.length,
    stations: masterStations,
    labels,
  };

  await mkdir(dirname(OUTPUT_PATH), { recursive: true });
  await writeFile(OUTPUT_PATH, JSON.stringify(master, null, 2), 'utf8');

  const basic = masterStations.filter((s) => s.license === 'basic').length;
  const challenge = masterStations.length - basic;
  console.log(`\n${masterStations.length} 駅を ${OUTPUT_PATH} に書き出した`);
  console.log(`  基本ライセンス: ${basic} 駅`);
  console.log(`  チャレンジ限定: ${challenge} 駅（${CHALLENGE_EXPIRES_AT} まで）`);
  console.log(`表示ラベル: ${Object.keys(labels).length} 件`);
  console.log(`ODPT データ取得日時: ${sourceDate}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
