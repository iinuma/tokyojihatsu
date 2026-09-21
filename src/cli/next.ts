/**
 * 検証用 CLI。G2 なしでコアロジックを確かめる。
 *
 *   npm run next -- --lat 35.6637 --lng 139.7839
 *   npm run next -- --station 月島
 *   npm run next -- --station 月島 --direction 光が丘
 *   npm run next -- --station 月島 --direction 光が丘 --at 2026-09-22T00:15
 */

import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { OdptClient } from '../odpt/client.js';
import { formatCountdown } from '../core/departures.js';
import { TokyoJihatsuService } from '../core/service.js';
import type { StationMaster } from '../core/master.js';

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

function parseArgs(argv: string[]): Record<string, string> {
  const args: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token?.startsWith('--')) continue;
    const key = token.slice(2);
    const value = argv[i + 1];
    if (value && !value.startsWith('--')) {
      args[key] = value;
      i += 1;
    } else {
      args[key] = 'true';
    }
  }
  return args;
}

async function loadToken(): Promise<string> {
  if (process.env.ODPT_TOKEN) return process.env.ODPT_TOKEN;
  const envFile = await readFile(resolve(PROJECT_ROOT, '.env'), 'utf8').catch(() => '');
  const match = /^ODPT_TOKEN=(.+)$/m.exec(envFile);
  if (!match?.[1]) throw new Error('ODPT_TOKEN が見つからない');
  return match[1].trim();
}

/** "2026-09-22T00:15" を JST として解釈する。 */
function parseAt(value: string | undefined): Date {
  if (!value) return new Date();
  const match = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(value);
  if (!match) throw new Error(`--at の形式が不正: ${value}（例 2026-09-22T00:15）`);
  const [, y, mo, d, h, mi, s] = match;
  return new Date(
    Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h) - 9, Number(mi), Number(s ?? 0)),
  );
}

function jstClock(date: Date): string {
  const shifted = new Date(date.getTime() + 9 * 3600_000);
  return `${shifted.toISOString().slice(0, 16).replace('T', ' ')} JST`;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const now = parseAt(args.at);

  const master = JSON.parse(
    await readFile(resolve(PROJECT_ROOT, 'data/stations.json'), 'utf8'),
  ) as StationMaster;
  const service = new TokyoJihatsuService(master, new OdptClient({ consumerKey: await loadToken() }));

  console.log(`現在時刻: ${jstClock(now)}   マスタ: ${master.stationCount} 駅\n`);

  // --lat/--lng: 近傍駅の候補出し
  if (args.lat && args.lng) {
    const nearby = service.nearbyStations(
      { lat: Number(args.lat), lng: Number(args.lng) },
      { limit: Number(args.limit ?? 8) },
    );
    if (nearby.length === 0) {
      console.log('2km 以内に対応駅がない。');
      return;
    }
    console.log('近くの駅');
    for (const entry of nearby) {
      const lines = [...new Set(entry.group.entries.map((s) => `${s.operatorName} ${s.railwayName}`))];
      console.log(`  ${entry.distanceLabel.padStart(6)}  ${entry.group.name}　${lines.join(' / ')}`);
    }
    return;
  }

  if (!args.station) {
    console.log('使い方:');
    console.log('  --lat <緯度> --lng <経度>            近くの駅を出す');
    console.log('  --station <駅名> [--direction <方面>] 次発を出す');
    console.log('  --at 2026-09-22T00:15                時刻を指定して検証する');
    return;
  }

  const groups = service.findGroupsByName(args.station);
  if (groups.length === 0) {
    console.log(`「${args.station}」に一致する対応駅がない。`);
    return;
  }

  const group = groups[0]!;
  const choices = service.directionChoices(group);
  const matched = args.direction
    ? choices.filter((c) => c.direction.label.includes(args.direction!) || c.direction.title.includes(args.direction!))
    : choices;

  if (matched.length === 0) {
    console.log(`「${args.direction}」に一致する方面がない。候補:`);
    for (const choice of choices) console.log(`  ${choice.label}`);
    return;
  }

  for (const choice of matched) {
    const snapshot = await service.countdown(choice.station, choice.direction, { now, count: 3 });
    console.log(`── ${choice.label}  [${snapshot.calendarReason}ダイヤ]`);

    if (snapshot.empty) {
      console.log('   次発なし（終電後・始発前）\n');
      continue;
    }

    const [first, ...rest] = snapshot.departures;
    const remaining = first!.at.getTime() - now.getTime();
    const detail = [first!.trainType, first!.destination ? `${first!.destination}行` : undefined]
      .filter(Boolean)
      .join(' ');

    console.log(`   あと ${formatCountdown(remaining)}    次発 ${first!.displayTime}  ${detail}${first!.isLast ? '  ※終電' : ''}`);
    for (const departure of rest) {
      const restDetail = [departure.trainType, departure.destination ? `${departure.destination}行` : undefined]
        .filter(Boolean)
        .join(' ');
      console.log(`                  ${departure.displayTime}  ${restDetail}${departure.isLast ? '  ※終電' : ''}`);
    }
    console.log();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
