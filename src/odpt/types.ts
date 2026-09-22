/**
 * ODPT（公共交通オープンデータセンター）v4 API のレスポンス型。
 * 必要なプロパティのみ定義する。実測したレスポンスに基づく（2026-09-21）。
 */

/** 駅時刻表を提供している 7 事業者。総当たり実測で確定（Notion 要件参照）。 */
export const TIMETABLE_OPERATORS = [
  'odpt.Operator:TokyoMetro',
  'odpt.Operator:Toei',
  'odpt.Operator:YokohamaMunicipal',
  'odpt.Operator:MIR',
  'odpt.Operator:TamaMonorail',
  'odpt.Operator:Yurikamome',
  'odpt.Operator:TWR',
] as const;

export type OperatorId = (typeof TIMETABLE_OPERATORS)[number];

/**
 * 公共交通オープンデータチャレンジ限定ライセンスで駅時刻表が提供される事業者。
 *
 * 通常の API（api.odpt.org）では 0 件で、**別のエンドポイント
 * api-challenge.odpt.org と専用トークン**が要る。チャレンジにエントリーすると
 * トークンが発行される。
 *
 * 許諾は 2027-03-12 に終了し、データの削除が義務づけられている
 * （チャレンジ限定ライセンス第 13 条）。期限後も動くよう、基本ライセンスの
 * データとは分けて持つ。
 */
export const CHALLENGE_OPERATORS = [
  'odpt.Operator:JR-East',
  'odpt.Operator:Keikyu',
  'odpt.Operator:Tokyu',
  'odpt.Operator:Keio',
  'odpt.Operator:Odakyu',
  'odpt.Operator:Seibu',
  'odpt.Operator:Tobu',
  'odpt.Operator:Sotetsu',
] as const;

export type ChallengeOperatorId = (typeof CHALLENGE_OPERATORS)[number];

export const CHALLENGE_OPERATOR_TITLES: Record<ChallengeOperatorId, string> = {
  'odpt.Operator:JR-East': 'JR東日本',
  'odpt.Operator:Keikyu': '京急',
  'odpt.Operator:Tokyu': '東急',
  'odpt.Operator:Keio': '京王',
  'odpt.Operator:Odakyu': '小田急',
  'odpt.Operator:Seibu': '西武',
  'odpt.Operator:Tobu': '東武',
  'odpt.Operator:Sotetsu': '相鉄',
};

/** チャレンジ用 API のベース URL。 */
export const CHALLENGE_BASE_URL = 'https://api-challenge.odpt.org/api/v4';

/**
 * 事業者単位で時刻表を引くと 1000 件で打ち切られる事業者。
 * 路線ごとに分けて取る必要がある（JR東日本は実測で 1000 件ちょうどだった）。
 */
export const PER_RAILWAY_OPERATORS: readonly string[] = ['odpt.Operator:JR-East'];

/** チャレンジ限定データの利用期限。これを過ぎたら該当駅を候補から外す。 */
export const CHALLENGE_EXPIRES_AT = '2027-03-12';

export const OPERATOR_TITLES: Record<OperatorId, string> = {
  'odpt.Operator:TokyoMetro': '東京メトロ',
  'odpt.Operator:Toei': '都営',
  'odpt.Operator:YokohamaMunicipal': '横浜市営',
  'odpt.Operator:MIR': 'つくばエクスプレス',
  'odpt.Operator:TamaMonorail': '多摩都市モノレール',
  'odpt.Operator:Yurikamome': 'ゆりかもめ',
  'odpt.Operator:TWR': 'りんかい線',
};

export interface OdptStation {
  'owl:sameAs': string;
  'dc:title'?: string;
  'odpt:stationTitle'?: Record<string, string>;
  'odpt:operator': string;
  'odpt:railway': string;
  'odpt:stationCode'?: string;
  'geo:lat'?: number;
  'geo:long'?: number;
  /** この駅の時刻表 ID 一覧。存在しなければ時刻表なし。 */
  'odpt:stationTimetable'?: string[];
}

export interface OdptRailway {
  'owl:sameAs': string;
  'dc:title'?: string;
  'odpt:railwayTitle'?: Record<string, string>;
  'odpt:operator': string;
  'odpt:lineCode'?: string;
  'odpt:ascendingRailDirection'?: string;
  'odpt:descendingRailDirection'?: string;
  'odpt:stationOrder'?: { 'odpt:station': string; 'odpt:index': number }[];
}

export interface OdptRailDirection {
  'owl:sameAs': string;
  'dc:title'?: string;
}

export interface OdptTrainType {
  'owl:sameAs': string;
  'dc:title'?: string;
}

export interface OdptTimetableObject {
  /** HH:MM。0 時台は翌日の運行を指す（配列は運行順）。 */
  'odpt:departureTime': string;
  'odpt:trainType'?: string;
  'odpt:trainNumber'?: string;
  'odpt:train'?: string;
  'odpt:destinationStation'?: string[];
  'odpt:isLast'?: boolean;
  'odpt:isFirst'?: boolean;
}

/**
 * 時刻表のカレンダー種別。
 * ほとんどの事業者は Weekday / SaturdayHoliday の 2 種だが、
 * 都電荒川線だけは SaturdayHoliday を持たず Saturday と Holiday に分かれている（実測）。
 */
export type CalendarId =
  | 'odpt.Calendar:Weekday'
  | 'odpt.Calendar:SaturdayHoliday'
  | 'odpt.Calendar:Saturday'
  | 'odpt.Calendar:Holiday';

export const CALENDAR_IDS: CalendarId[] = [
  'odpt.Calendar:Weekday',
  'odpt.Calendar:SaturdayHoliday',
  'odpt.Calendar:Saturday',
  'odpt.Calendar:Holiday',
];

export interface OdptStationTimetable {
  'owl:sameAs': string;
  'odpt:station': string;
  'odpt:railway': string;
  'odpt:operator': string;
  'odpt:railDirection'?: string;
  'odpt:calendar'?: string;
  'dc:date'?: string;
  'dct:issued'?: string;
  'odpt:stationTimetableObject': OdptTimetableObject[];
}
