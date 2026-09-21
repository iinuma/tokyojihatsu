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

/** 中継してよいデータ型。これ以外は 404 にする。 */
const ALLOWED_DATA_TYPES = new Set([
  'odpt:Station',
  'odpt:StationTimetable',
  'odpt:Railway',
  'odpt:RailDirection',
  'odpt:TrainType',
]);

/** 転送してよいクエリ。`acl:consumerKey` は受け取らず、こちらで付ける。 */
const ALLOWED_PARAMS = new Set([
  'odpt:operator',
  'odpt:station',
  'odpt:railway',
  'odpt:railDirection',
  'odpt:calendar',
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
};

export interface ProxyRequest {
  /** "/api/v4/odpt:Station" のようなパス、または "odpt:Station" だけでもよい。 */
  path: string;
  query: Record<string, string | undefined>;
  method: string;
}

export interface ProxyResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

export interface ProxyOptions {
  token: string;
  fetchImpl?: typeof fetch;
  baseUrl?: string;
}

const CORS_HEADERS: Record<string, string> = {
  // WebView の origin は固定できないので * にする。ODPT 自身も * を返す。
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
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

  const dataType = dataTypeFromPath(request.path);
  if (!dataType || !ALLOWED_DATA_TYPES.has(dataType)) {
    return json(404, { error: `扱えないデータ型です: ${dataType ?? '(なし)'}` });
  }

  if (!options.token) {
    return json(500, { error: 'ODPT トークンが設定されていません' });
  }

  const url = new URL(`${(options.baseUrl ?? ODPT_BASE).replace(/\/$/, '')}/${dataType}`);
  for (const [key, value] of Object.entries(request.query)) {
    if (value === undefined) continue;
    // 許可していないクエリは黙って落とす。キーの上書きも防ぐ。
    if (!ALLOWED_PARAMS.has(key)) continue;
    url.searchParams.set(key, value);
  }
  url.searchParams.set('acl:consumerKey', options.token);

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
