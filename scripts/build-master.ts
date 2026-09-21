/**
 * ODPT から駅マスタ（data/stations.json）を生成する。
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
  OPERATOR_TITLES,
  TIMETABLE_OPERATORS,
  type CalendarId,
  type OdptStation,
  type OperatorId,
} from '../src/odpt/types.js';
import type { MasterDirection, MasterStation, StationMaster } from '../src/core/master.js';

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUTPUT_PATH = resolve(PROJECT_ROOT, 'data/stations.json');

async function loadToken(): Promise<string> {
  const fromEnv = process.env.ODPT_TOKEN;
  if (fromEnv) return fromEnv;

  const envFile = await readFile(resolve(PROJECT_ROOT, '.env'), 'utf8').catch(() => '');
  const match = /^ODPT_TOKEN=(.+)$/m.exec(envFile);
  if (!match?.[1]) {
    throw new Error('ODPT_TOKEN が見つからない。.env に設定するか環境変数で渡す。');
  }
  return match[1].trim();
}

function stationName(station: OdptStation): string {
  return station['odpt:stationTitle']?.ja ?? station['dc:title'] ?? station['owl:sameAs'];
}

/** 「光が丘方面」。行先が終着駅名と同じでも問題ないのでそのまま付ける。 */
function directionLabel(destinationName: string | undefined, fallback: string): string {
  if (!destinationName) return fallback;
  return `${destinationName}方面`;
}

async function main(): Promise<void> {
  const client = new OdptClient({ consumerKey: await loadToken() });

  console.log('RailDirection を取得中…');
  const railDirections = await client.railDirections();
  const directionTitles = new Map(
    railDirections.map((d) => [d['owl:sameAs'], d['dc:title'] ?? d['owl:sameAs']]),
  );

  /** ODPT 全体の駅名辞書。行先表示のため 7 事業者以外の駅も後で足す。 */
  const stationNames = new Map<string, string>();
  const railwayTitles = new Map<string, string>();
  const stationsByOperator = new Map<OperatorId, OdptStation[]>();

  for (const operator of TIMETABLE_OPERATORS) {
    console.log(`${OPERATOR_TITLES[operator]}: 駅・路線を取得中…`);
    const [stations, railways] = await Promise.all([
      client.stations(operator),
      client.railways(operator),
    ]);
    stationsByOperator.set(operator, stations);
    for (const station of stations) {
      stationNames.set(station['owl:sameAs'], stationName(station));
    }
    for (const railway of railways) {
      railwayTitles.set(
        railway['owl:sameAs'],
        railway['odpt:railwayTitle']?.ja ?? railway['dc:title'] ?? railway['owl:sameAs'],
      );
    }
  }

  /** 駅 × 方面 → { カレンダー別の時刻表 ID, 行先の出現回数 } */
  type DirectionAccumulator = {
    timetables: Partial<Record<CalendarId, string>>;
    destinationCounts: Map<string, number>;
  };

  /** 時刻表に実際に出現した行先駅・列車種別の ID。表示ラベル辞書を作るのに使う。 */
  const usedDestinationIds = new Set<string>();
  const usedTrainTypeIds = new Set<string>();
  const directionsByStation = new Map<string, Map<string, DirectionAccumulator>>();

  let sourceDate = '';

  for (const operator of TIMETABLE_OPERATORS) {
    console.log(`${OPERATOR_TITLES[operator]}: 時刻表を取得中…（数十 MB）`);
    const timetables = await client.stationTimetablesByOperator(operator);
    console.log(`  ${timetables.length} レコード`);

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

  // 行先・種別に出てくる事業者のうち、7 事業者に含まれないもの（直通先）を補う。
  const extraOperators = new Set<string>();
  for (const id of [...usedDestinationIds, ...usedTrainTypeIds]) {
    const match = /^odpt\.(?:Station|TrainType):([^.]+)\./.exec(id);
    const operator = match?.[1] ? `odpt.Operator:${match[1]}` : undefined;
    if (!operator) continue;
    if ((TIMETABLE_OPERATORS as readonly string[]).includes(operator)) continue;
    extraOperators.add(operator);
  }

  const trainTypeTitles = new Map<string, string>();
  const operatorsForLabels = [...TIMETABLE_OPERATORS, ...extraOperators];

  for (const operator of operatorsForLabels) {
    const isExtra = !(TIMETABLE_OPERATORS as readonly string[]).includes(operator);
    console.log(`表示ラベルを取得中: ${operator}${isExtra ? '（直通先）' : ''}`);

    if (isExtra) {
      for (const station of await client.stations(operator).catch(() => [])) {
        stationNames.set(station['owl:sameAs'], stationName(station));
      }
    }
    for (const trainType of await client.trainTypes(operator).catch(() => [])) {
      const title = trainType['dc:title'];
      if (title) trainTypeTitles.set(trainType['owl:sameAs'], title);
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

  for (const operator of TIMETABLE_OPERATORS) {
    for (const station of stationsByOperator.get(operator) ?? []) {
      const stationId = station['owl:sameAs'];
      const byDirection = directionsByStation.get(stationId);
      if (!byDirection || byDirection.size === 0) continue; // 時刻表がない駅は候補に出さない

      const lat = station['geo:lat'];
      const lng = station['geo:long'];
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

      masterStations.push({
        id: stationId,
        name: stationName(station),
        lat,
        lng,
        operator,
        operatorName: OPERATOR_TITLES[operator],
        railway: station['odpt:railway'],
        railwayName: railwayTitles.get(station['odpt:railway']) ?? station['odpt:railway'],
        stationCode: station['odpt:stationCode'],
        directions,
      });
    }
  }

  masterStations.sort((a, b) => a.id.localeCompare(b.id));

  const master: StationMaster = {
    generatedAt: new Date().toISOString(),
    sourceDate,
    stationCount: masterStations.length,
    stations: masterStations,
    labels,
  };

  await mkdir(dirname(OUTPUT_PATH), { recursive: true });
  await writeFile(OUTPUT_PATH, JSON.stringify(master, null, 2), 'utf8');

  console.log(`\n${masterStations.length} 駅を ${OUTPUT_PATH} に書き出した`);
  console.log(`表示ラベル: ${Object.keys(labels).length} 件`);
  console.log(`ODPT データ取得日時: ${sourceDate}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
