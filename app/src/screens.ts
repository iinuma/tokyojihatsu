/**
 * 画面の組み立て。SDK に渡すコンテナ定義と、更新用のテキストを作る。
 * 状態遷移は main.ts が持ち、ここは「今の状態をどう描くか」だけを扱う。
 */

import {
  ListContainerProperty,
  ListItemContainerProperty,
  TextContainerProperty,
} from '@evenrealities/even_hub_sdk';

import { formatCountdown, type Departure } from '../../src/core/departures.js';
import type { MasterDirection, MasterStation } from '../../src/core/master.js';
import type { NearbyStation } from '../../src/core/service.js';
import {
  BRIGHT,
  COUNTDOWN,
  DIM,
  DISTANCE_COLUMN,
  NOTICE,
  PICKER,
  padCenter,
  padToColumn,
  truncateItem,
} from './layout.js';

/** List コンテナは 20 項目まで。 */
const MAX_ITEMS = 20;

export interface PageContainers {
  containerTotalNum: number;
  textObject?: TextContainerProperty[];
  listObject?: ListContainerProperty[];
}

function textContainer(
  spec: { id: number; name: string; x: number; y: number; width: number; height: number },
  content: string,
  options: { capture?: boolean; color?: number } = {},
): TextContainerProperty {
  return new TextContainerProperty({
    containerID: spec.id,
    containerName: spec.name,
    xPosition: spec.x,
    yPosition: spec.y,
    width: spec.width,
    height: spec.height,
    content,
    textColor: options.color ?? BRIGHT,
    isEventCapture: options.capture ? 1 : 0,
    borderWidth: 0,
    paddingLength: 4,
  });
}

/**
 * 駅を選ぶ画面。
 *
 * 見出しを差し替えられるようにしてあるのは、徒歩圏に対応駅がないときに
 * 範囲を広げて「最寄り」を出すため。ODPT で時刻表が取れるのは 7 事業者だけなので、
 * JR・東急・京急しか通っていない地域では徒歩圏に 1 駅も無いことが普通にある。
 */
export function stationPickerPage(
  nearby: readonly NearbyStation[],
  headline = '近くの駅',
): PageContainers {
  // 駅名は左端から、距離は画面中央あたりから始める。
  const items = nearby
    .slice(0, MAX_ITEMS)
    .map((entry) =>
      truncateItem(padToColumn(entry.group.name, DISTANCE_COLUMN) + entry.distanceLabel),
    );

  return {
    containerTotalNum: 2,
    textObject: [textContainer(PICKER.header, headline, { color: DIM })],
    listObject: [
      new ListContainerProperty({
        containerID: PICKER.list.id,
        containerName: PICKER.list.name,
        xPosition: PICKER.list.x,
        yPosition: PICKER.list.y,
        width: PICKER.list.width,
        height: PICKER.list.height,
        isEventCapture: 1,
        borderWidth: 0,
        paddingLength: 4,
        itemContainer: new ListItemContainerProperty({
          itemCount: items.length,
          itemWidth: PICKER.list.width,
          isItemSelectBorderEn: 1,
          itemName: items,
        }),
      }),
    ],
  };
}

export interface DirectionOption {
  station: MasterStation;
  direction: MasterDirection;
  label: string;
}

/** 路線・方面を選ぶ画面。 */
export function directionPickerPage(
  stationName: string,
  options: readonly DirectionOption[],
): PageContainers {
  const items = options
    .slice(0, MAX_ITEMS)
    .map((option) => truncateItem(`${option.station.railwayName}・${option.direction.label}`));

  return {
    containerTotalNum: 2,
    textObject: [textContainer(PICKER.header, stationName, { color: DIM })],
    listObject: [
      new ListContainerProperty({
        containerID: PICKER.list.id,
        containerName: PICKER.list.name,
        xPosition: PICKER.list.x,
        yPosition: PICKER.list.y,
        width: PICKER.list.width,
        height: PICKER.list.height,
        isEventCapture: 1,
        borderWidth: 0,
        paddingLength: 4,
        itemContainer: new ListItemContainerProperty({
          itemCount: items.length,
          itemWidth: PICKER.list.width,
          isItemSelectBorderEn: 1,
          itemName: items,
        }),
      }),
    ],
  };
}

export interface CountdownTexts {
  remaining: string;
  upcoming: string;
  footer: string;
}

/**
 * カウントダウン画面の 3 つのテキスト。
 * 毎秒の更新では remaining だけを textContainerUpgrade で差し替える。
 */
export function countdownTexts(
  station: MasterStation,
  direction: MasterDirection,
  departures: readonly Departure[],
  now: number,
): CountdownTexts {
  const [first, second] = departures;

  const remaining = first
    ? padCenter(`あと ${formatCountdown(first.at.getTime() - now)}`, 26)
    : padCenter('次の電車なし', 26);

  const upcomingLines: string[] = [];
  if (first) upcomingLines.push(`次発 ${first.displayTime}${first.isLast ? ' 終' : ''}`);
  if (second) upcomingLines.push(`次々発 ${second.displayTime}${second.isLast ? ' 終' : ''}`);
  if (upcomingLines.length === 0) upcomingLines.push('終電後');

  // 「時刻表ベース」の注記はここには置かない。ライセンス上の必須表示ではなく
  // （必須の 3 点と取得日時は「データについて」にある）、毎秒見る画面に
  // 常駐させる価値がない。遅延を反映しない旨はそちらに書いてある。
  const footer = `${station.name}　${station.railwayName}・${direction.label}`;

  return { remaining, upcoming: upcomingLines.join('\n'), footer };
}

/** カウントダウン画面のコンテナ。 */
export function countdownPage(texts: CountdownTexts): PageContainers {
  return {
    containerTotalNum: 3,
    textObject: [
      textContainer(COUNTDOWN.remaining, texts.remaining),
      textContainer(COUNTDOWN.upcoming, texts.upcoming),
      // 入力は footer で受ける。カウントダウンは毎秒差し替えるので、
      // 溢れたときの firmware 側スクロールに巻き込まれないようにしておく。
      textContainer(COUNTDOWN.footer, texts.footer, { capture: true, color: DIM }),
    ],
  };
}

/** 1 枚もののお知らせ画面（読み込み中・エラー・情報）。 */
export function noticePage(body: string): PageContainers {
  return {
    containerTotalNum: 1,
    textObject: [textContainer(NOTICE.body, body, { capture: true })],
  };
}

/**
 * ODPT のガイドラインで表示が要る 3 点と取得日時。
 * 常時表示の義務はないので、コンテキストメニューから開くこの画面にまとめる。
 */
export function aboutText(sourceDate: string, contactEmail: string): string {
  return [
    'このアプリの時刻表データは',
    '公共交通オープンデータセンターの提供です。',
    'データの正確性・完全性は保証されていません。',
    '表示は時刻表上の予定時刻で、遅延は反映されません。',
    `データ取得日時: ${sourceDate || '不明'}`,
    `連絡先: ${contactEmail}`,
    '',
    'タップで戻る',
  ].join('\n');
}
