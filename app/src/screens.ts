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
  HEADER_COLUMNS,
  NOTICE,
  PICKER,
  padToColumn,
  truncateItem,
  truncateToWidth,
  visualWidth,
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
  clock: string;
  /** 上段の右。駅・路線・方面。 */
  header: string;
  remaining: string;
  upcoming: string;
}

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'] as const;

/**
 * 左上に出す日時。「22(火) 05:26:13」。
 * JST 固定で組み立てる。端末のタイムゾーン設定に振り回されないため。
 */
export function clockText(now: number): string {
  const jst = new Date(now + 9 * 3600_000);
  const day = jst.getUTCDate();
  const weekday = WEEKDAYS[jst.getUTCDay()] ?? '';
  const hh = String(jst.getUTCHours()).padStart(2, '0');
  const mm = String(jst.getUTCMinutes()).padStart(2, '0');
  const ss = String(jst.getUTCSeconds()).padStart(2, '0');
  return `${day}(${weekday}) ${hh}:${mm}:${ss}`;
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
  options: { stale?: boolean } = {},
): CountdownTexts {
  const [first, second] = departures;

  // 左寄せ。中央に寄せても等幅でないぶん揃わず、位置が読みにくくなるだけだった。
  // 取得に続けて失敗しているときは黙って止まらない。時刻表が古いことを示す。
  const remaining = first
    ? `あと ${formatCountdown(first.at.getTime() - now)}`
    : options.stale
      ? '時刻表を取得中…'
      : '次の電車なし';

  const upcomingLines: string[] = [];
  if (first) upcomingLines.push(`次発 ${first.displayTime}${first.isLast ? ' 終' : ''}`);
  if (second) upcomingLines.push(`次々発 ${second.displayTime}${second.isLast ? ' 終' : ''}`);
  if (upcomingLines.length === 0) upcomingLines.push('終電後');

  return {
    clock: clockText(now),
    header: headerText(station, direction),
    remaining,
    upcoming: upcomingLines.join('\n'),
  };
}

/**
 * 上段に出す「どの駅のどの方面か」。
 *
 * 路線名まで入れたいが、上段の幅は限られる。入らないときは路線名を落とす。
 * 駅と方面が分かれば用は足り、路線は方面ラベルからも概ね察しがつく。
 */
export function headerText(station: MasterStation, direction: MasterDirection): string {
  const full = `${station.name} ${station.railwayName}・${direction.label}`;
  if (visualWidth(full) <= HEADER_COLUMNS) return full;

  const short = `${station.name} ${direction.label}`;
  if (visualWidth(short) <= HEADER_COLUMNS) return short;

  return truncateToWidth(short, HEADER_COLUMNS);
}

/** カウントダウン画面のコンテナ。 */
export function countdownPage(texts: CountdownTexts): PageContainers {
  return {
    containerTotalNum: 4,
    textObject: [
      textContainer(COUNTDOWN.clock, texts.clock, { color: DIM }),
      // 駅・方面は自分で選んだ情報なので明るさを落とす。文字サイズは変えられない。
      textContainer(COUNTDOWN.header, texts.header, { color: DIM }),
      // 入力はここで受ける。毎秒差し替わるが内容は短いので、
      // 溢れによる firmware 側スクロールには掛からない。
      textContainer(COUNTDOWN.remaining, texts.remaining, { capture: true }),
      textContainer(COUNTDOWN.upcoming, texts.upcoming),
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
export function aboutText(
  sourceDate: string,
  contactEmail: string,
  options: { challengeExpiresAt?: string } = {},
): string {
  const lines = [
    'このアプリの時刻表データは',
    '公共交通オープンデータセンターの提供です。',
    'データの正確性・完全性は保証されていません。',
    '表示は時刻表上の予定時刻で、遅延は反映されません。',
  ];

  // チャレンジ限定ライセンスのデータを含むことと、その期限を明示する。
  // 期限後は対応範囲が基本ライセンスのぶんへ戻る。
  if (options.challengeExpiresAt) {
    lines.push(
      `JR東日本・京急などの時刻表は公共交通オープンデータ`,
      `チャレンジ限定ライセンスにより${options.challengeExpiresAt}まで`,
      `提供されます。以降は対象駅が変わります。`,
    );
  }

  lines.push(`データ取得日時: ${sourceDate || '不明'}`, `連絡先: ${contactEmail}`, '', 'タップで戻る');
  return lines.join('\n');
}
