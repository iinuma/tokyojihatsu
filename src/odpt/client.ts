import type {
  OdptRailDirection,
  OdptRailway,
  OdptStation,
  OdptStationTimetable,
  OdptTrainType,
} from './types.js';

const DEFAULT_BASE = 'https://api.odpt.org/api/v4';

export interface OdptClientOptions {
  consumerKey: string;
  /**
   * ベース URL。Even Hub 公開時は API キーを秘匿するためプロキシを指す
   * （FAQ:「Move keys behind a server-side proxy.」）。
   */
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

/**
 * ODPT v4 の薄いラッパー。
 * ODPT は `Access-Control-Allow-Origin: *` を返すのでブラウザから直接叩ける
 * （consumerKey はクエリ文字列なのでプリフライトも起きない）。
 */
export class OdptClient {
  private readonly baseUrl: string;
  private readonly consumerKey: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: OdptClientOptions) {
    this.consumerKey = options.consumerKey;
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE).replace(/\/$/, '');
    // fetch をそのまま代入すると this が外れる。Node では動くが、ブラウザでは
    // "Can only call Window.fetch on instances of Window" で落ちる（実機で遭遇）。
    this.fetchImpl = options.fetchImpl ?? ((input, init) => globalThis.fetch(input, init));
  }

  private async get<T>(dataType: string, params: Record<string, string> = {}): Promise<T[]> {
    const url = new URL(`${this.baseUrl}/${dataType}`);
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }
    url.searchParams.set('acl:consumerKey', this.consumerKey);

    const response = await this.fetchImpl(url.toString());
    if (!response.ok) {
      throw new OdptError(
        `ODPT ${dataType} が ${response.status} ${response.statusText} を返した`,
        response.status,
        dataType,
      );
    }
    return (await response.json()) as T[];
  }

  stations(operator: string): Promise<OdptStation[]> {
    return this.get<OdptStation>('odpt:Station', { 'odpt:operator': operator });
  }

  railways(operator: string): Promise<OdptRailway[]> {
    return this.get<OdptRailway>('odpt:Railway', { 'odpt:operator': operator });
  }

  railDirections(): Promise<OdptRailDirection[]> {
    return this.get<OdptRailDirection>('odpt:RailDirection');
  }

  trainTypes(operator: string): Promise<OdptTrainType[]> {
    return this.get<OdptTrainType>('odpt:TrainType', { 'odpt:operator': operator });
  }

  /** 時刻表を ID 指定で取得する。実行時に 1 レコードだけ引くのに使う。 */
  stationTimetablesById(ids: string[]): Promise<OdptStationTimetable[]> {
    if (ids.length === 0) return Promise.resolve([]);
    return this.get<OdptStationTimetable>('odpt:StationTimetable', {
      'owl:sameAs': ids.join(','),
    });
  }

  /** 事業者の全時刻表。マスタ生成用（件数が多いので実行時には使わない）。 */
  stationTimetablesByOperator(operator: string): Promise<OdptStationTimetable[]> {
    return this.get<OdptStationTimetable>('odpt:StationTimetable', {
      'odpt:operator': operator,
    });
  }
}

export class OdptError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly dataType: string,
  ) {
    super(message);
    this.name = 'OdptError';
  }
}
