/**
 * ODPT への中継。
 *
 * 2 つの役目を兼ねる。どちらも Even Hub で公開するなら避けて通れない。
 *
 * 1. **API キーの秘匿。** `.ehpk` は誰でも展開できるので、キーをアプリに
 *    同梱できない（FAQ:「Move keys behind a server-side proxy.」）。
 *    キーはここだけが持ち、クライアントは知らない。
 * 2. **データ更新義務。** ODPT 開発者ガイドライン 2.2.2 は「更新通知から
 *    1 週間以内にデータ更新」を求める。Even Hub はロールバック不可・全リリース
 *    審査経由なので、データ更新のたびにアプリを出し直す構成は破綻する。
 *    ここが都度 ODPT を引けば、アプリのリリースなしで常に最新になる。
 *
 * 素通しにはしない。中継先のデータ型とクエリを絞って、キーを任意の
 * ODPT 呼び出しに使われないようにする。
 */

const ODPT_BASE = 'https://api.odpt.org/api/v4';
/**
 * チャレンジ限定ライセンスのデータは別のエンドポイントと別のトークン。
 * 通常の API では 0 件が返るだけで、混同すると原因が分かりにくい。
 */
const ODPT_CHALLENGE_BASE = 'https://api-challenge.odpt.org/api/v4';

/** パスの先頭がこれならチャレンジ用に振り分ける。 */
const CHALLENGE_PREFIX = '/challenge/';

/** 中継してよいデータ型。これ以外は 404 にする。 */
const ALLOWED_DATA_TYPES = new Set([
  'odpt:Station',
  'odpt:StationTimetable',
  'odpt:Railway',
  'odpt:RailDirection',
  'odpt:TrainType',
  // 列車の現在位置と、列車ごとの時刻表。位置は数分で古くなる。
  'odpt:Train',
  'odpt:TrainTimetable',
]);

/** 転送してよいクエリ。`acl:consumerKey` は受け取らず、こちらで付ける。 */
const ALLOWED_PARAMS = new Set([
  'odpt:operator',
  'odpt:station',
  'odpt:railway',
  'odpt:railDirection',
  'odpt:calendar',
  'odpt:trainNumber',
  'owl:sameAs',
]);

/**
 * データ型ごとのキャッシュ時間（秒）。
 * 駅や路線の定義はまず変わらない。時刻表も日中に変わるものではないが、
 * ダイヤ改正を取りこぼさない程度には短くしておく。
 */
const CACHE_SECONDS: Record<string, number> = {
  'odpt:Station': 86_400,
  'odpt:Railway': 86_400,
  'odpt:RailDirection': 86_400,
  'odpt:TrainType': 86_400,
  'odpt:StationTimetable': 3_600,
  'odpt:TrainTimetable': 3_600,
  /**
   * 列車の現在位置。`dct:valid` が 5 分なので、それより短く持つ。
   * 開発者ガイドライン 2.1 は「最新でなくなった情報を表示しない」ことを
   * 求めており、キャッシュで古い位置を配り続けるのは違反になる。
   */
  'odpt:Train': 30,
};

export interface ProxyRequest {
  /** "/api/v4/odpt:Station" のようなパス、または "odpt:Station" だけでもよい。 */
  path: string;
  query: Record<string, string | undefined>;
  method: string;
  /** 小文字化したヘッダ名 → 値。アプリからの呼び出しか確かめるのに使う。 */
  headers?: Record<string, string | undefined>;
  /** 呼び出し元の IP。レート制限に使う。 */
  sourceIp?: string;
}

export interface ProxyResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

export interface ProxyOptions {
  token: string;
  /**
   * アプリが送ってくる共有鍵。設定すると、一致しないリクエストを 403 で返す。
   *
   * ODPT のライセンスは基本・限定とも、データを「第三者が再利用可能な状態で
   * 公開、再配布、公衆送信」することを禁じている（第 8 条 4(1)）。
   * URL を知るだけで JSON が取れる状態は、これに当たると読める。
   *
   * .ehpk は展開できるので鍵は完全には隠せない。ここで目指すのは
   * 「誰でも叩ける API として公開しない」ことであって、完全な防御ではない。
   */
  appKey?: string;
  /**
   * チャレンジ限定ライセンス用のトークン。
   * 未設定なら /challenge/ 以下は 404 にする（データを持たないため）。
   */
  challengeToken?: string;
  /** 1 分あたりの上限。既定 60。0 で無効。 */
  rateLimitPerMinute?: number;
  fetchImpl?: typeof fetch;
  baseUrl?: string;
  /** テスト用の時刻源。 */
  now?: () => number;
}

/** アプリが共有鍵を載せるヘッダ名。 */
export const APP_KEY_HEADER = 'x-tokyojihatsu-key';

/**
 * CORS は **ここだけ**が返す。
 *
 * Lambda Function URL 側にも CORS 設定があるが、両方で設定すると
 * `Access-Control-Allow-Origin` が 2 つ返る（一方は `*`、もう一方は Origin の
 * エコー）。ブラウザはこのヘッダが複数あると仕様上エラーにするので、
 * WebView からの fetch が "Load failed" で落ちる。実機で遭遇したので
 * インフラ側（proxy/infra/stack.ts）の cors は外してある。
 */
const CORS_HEADERS: Record<string, string> = {
  // WebView の origin は固定できないので * にする。ODPT 自身も * を返す。
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  // 共有鍵をカスタムヘッダで送るため、プリフライトで許可しておく。
  'Access-Control-Allow-Headers': `Content-Type, ${'X-Tokyojihatsu-Key'}`,
  'Access-Control-Max-Age': '86400',
};

function json(status: number, payload: unknown, extra: Record<string, string> = {}): ProxyResponse {
  return {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS_HEADERS, ...extra },
    body: JSON.stringify(payload),
  };
}

/** パスの末尾からデータ型を取り出す。 */
export function dataTypeFromPath(path: string): string | null {
  const trimmed = path.replace(/\/+$/, '');
  const last = trimmed.slice(trimmed.lastIndexOf('/') + 1);
  return last.length > 0 ? decodeURIComponent(last) : null;
}

/**
 * 直近 1 分のリクエスト数。Lambda の実行環境ごとに持つので厳密ではないが、
 * 単純な総当たりや連打を抑えるには足りる。正確さが要るなら DynamoDB に移す。
 */
const recentRequests = new Map<string, number[]>();

function withinRateLimit(sourceIp: string | undefined, limit: number, now: number): boolean {
  if (limit <= 0) return true;
  const key = sourceIp ?? 'unknown';
  const windowStart = now - 60_000;

  const hits = (recentRequests.get(key) ?? []).filter((at) => at > windowStart);
  hits.push(now);
  recentRequests.set(key, hits);

  // 覚えっぱなしにしないよう、古い IP を捨てる。
  if (recentRequests.size > 1000) {
    for (const [ip, times] of recentRequests) {
      if (times.every((at) => at <= windowStart)) recentRequests.delete(ip);
    }
  }

  return hits.length <= limit;
}

/** テスト用。 */
export function resetRateLimit(): void {
  recentRequests.clear();
}

export async function handleProxyRequest(
  request: ProxyRequest,
  options: ProxyOptions,
): Promise<ProxyResponse> {
  if (request.method === 'OPTIONS') {
    return { status: 204, headers: CORS_HEADERS, body: '' };
  }
  if (request.method !== 'GET') {
    return json(405, { error: 'GET と OPTIONS のみ受け付けます' });
  }

  // 共有鍵の確認。ライセンス上、データを誰でも取れる状態にはできない。
  if (options.appKey) {
    const provided = request.headers?.[APP_KEY_HEADER];
    if (provided !== options.appKey) {
      return json(403, { error: 'このエンドポイントは東京次発アプリ専用です' });
    }
  }

  const now = (options.now ?? Date.now)();
  if (!withinRateLimit(request.sourceIp, options.rateLimitPerMinute ?? 60, now)) {
    return json(429, { error: 'リクエストが多すぎます' }, { 'Retry-After': '60' });
  }

  const dataType = dataTypeFromPath(request.path);
  if (!dataType || !ALLOWED_DATA_TYPES.has(dataType)) {
    return json(404, { error: `扱えないデータ型です: ${dataType ?? '(なし)'}` });
  }

  // /challenge/ で始まるパスはチャレンジ限定ライセンス側へ回す。
  const useChallenge = request.path.startsWith(CHALLENGE_PREFIX);
  const token = useChallenge ? options.challengeToken : options.token;

  if (!token) {
    return useChallenge
      ? json(404, { error: 'チャレンジ限定データは提供していません' })
      : json(500, { error: 'ODPT トークンが設定されていません' });
  }

  const defaultBase = useChallenge ? ODPT_CHALLENGE_BASE : ODPT_BASE;
  const url = new URL(`${(options.baseUrl ?? defaultBase).replace(/\/$/, '')}/${dataType}`);
  for (const [key, value] of Object.entries(request.query)) {
    if (value === undefined) continue;
    // 許可していないクエリは黙って落とす。キーの上書きも防ぐ。
    if (!ALLOWED_PARAMS.has(key)) continue;
    url.searchParams.set(key, value);
  }
  url.searchParams.set('acl:consumerKey', token);

  const doFetch = options.fetchImpl ?? ((input: RequestInfo | URL, init?: RequestInit) =>
    globalThis.fetch(input, init));

  let upstream: Response;
  try {
    upstream = await doFetch(url.toString());
  } catch (error) {
    return json(502, {
      error: 'ODPT に到達できませんでした',
      detail: error instanceof Error ? error.message : String(error),
    });
  }

  const text = await upstream.text();

  if (!upstream.ok) {
    // ODPT の応答をそのまま返さない。キーがエラー本文に載る可能性を避ける。
    return json(upstream.status === 429 ? 429 : 502, {
      error: `ODPT が ${upstream.status} を返しました`,
    });
  }

  const maxAge = CACHE_SECONDS[dataType] ?? 3_600;
  return {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': `public, max-age=${maxAge}`,
      ...CORS_HEADERS,
    },
    body: text,
  };
}
