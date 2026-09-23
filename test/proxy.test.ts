import { strict as assert } from 'node:assert';
import { beforeEach, describe, it } from 'node:test';

import {
  APP_KEY_HEADER,
  dataTypeFromPath,
  handleProxyRequest,
  resetRateLimit,
} from '../proxy/src/proxy.js';

/** 上流の ODPT を差し替えて、何を投げたかを記録する。 */
function upstream(body: unknown = [], status = 200) {
  const calls: string[] = [];
  const fetchImpl = ((input: RequestInfo | URL) => {
    calls.push(String(input));
    return Promise.resolve(
      new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
    );
  }) as typeof fetch;
  return { calls, fetchImpl };
}

const TOKEN = 'server-side-secret';
const APP_KEY = 'app-shared-key';

beforeEach(() => {
  resetRateLimit();
});

describe('中継するデータ型', () => {
  it('許可したデータ型は通す', async () => {
    const { calls, fetchImpl } = upstream([{ 'owl:sameAs': 'x' }]);
    const response = await handleProxyRequest(
      { path: '/odpt:Station', query: {}, method: 'GET' },
      { token: TOKEN, fetchImpl },
    );

    assert.equal(response.status, 200);
    assert.ok(calls[0]!.includes('/odpt:Station'));
  });

  it('許可していないデータ型は 404 にする', async () => {
    const { calls, fetchImpl } = upstream();
    const response = await handleProxyRequest(
      { path: '/odpt:Bus', query: {}, method: 'GET' },
      { token: TOKEN, fetchImpl },
    );

    assert.equal(response.status, 404);
    assert.equal(calls.length, 0); // 上流に投げない
  });

  it('パスの末尾からデータ型を取る', () => {
    assert.equal(dataTypeFromPath('/api/v4/odpt:Station'), 'odpt:Station');
    assert.equal(dataTypeFromPath('/odpt:Station/'), 'odpt:Station');
    assert.equal(dataTypeFromPath('/'), null);
  });
});

describe('API キーの扱い', () => {
  it('キーはサーバー側で付ける', async () => {
    const { calls, fetchImpl } = upstream();
    await handleProxyRequest(
      { path: '/odpt:Station', query: { 'odpt:operator': 'odpt.Operator:Toei' }, method: 'GET' },
      { token: TOKEN, fetchImpl },
    );

    const url = new URL(calls[0]!);
    assert.equal(url.searchParams.get('acl:consumerKey'), TOKEN);
  });

  it('クライアントが送ったキーは無視する', async () => {
    const { calls, fetchImpl } = upstream();
    await handleProxyRequest(
      { path: '/odpt:Station', query: { 'acl:consumerKey': 'attacker' }, method: 'GET' },
      { token: TOKEN, fetchImpl },
    );

    assert.equal(new URL(calls[0]!).searchParams.get('acl:consumerKey'), TOKEN);
  });

  it('許可していないクエリは落とす', async () => {
    const { calls, fetchImpl } = upstream();
    await handleProxyRequest(
      { path: '/odpt:Station', query: { 'odpt:operator': 'odpt.Operator:Toei', evil: '1' }, method: 'GET' },
      { token: TOKEN, fetchImpl },
    );

    const url = new URL(calls[0]!);
    assert.equal(url.searchParams.get('odpt:operator'), 'odpt.Operator:Toei');
    assert.equal(url.searchParams.get('evil'), null);
  });

  it('トークン未設定なら上流に投げずに 500', async () => {
    const { calls, fetchImpl } = upstream();
    const response = await handleProxyRequest(
      { path: '/odpt:Station', query: {}, method: 'GET' },
      { token: '', fetchImpl },
    );

    assert.equal(response.status, 500);
    assert.equal(calls.length, 0);
  });
});

describe('CORS とキャッシュ', () => {
  it('CORS ヘッダを返す', async () => {
    const { fetchImpl } = upstream();
    const response = await handleProxyRequest(
      { path: '/odpt:Station', query: {}, method: 'GET' },
      { token: TOKEN, fetchImpl },
    );

    assert.equal(response.headers['Access-Control-Allow-Origin'], '*');
  });

  it('プリフライトに 204 で答える', async () => {
    const { calls, fetchImpl } = upstream();
    const response = await handleProxyRequest(
      { path: '/odpt:Station', query: {}, method: 'OPTIONS' },
      { token: TOKEN, fetchImpl },
    );

    assert.equal(response.status, 204);
    assert.equal(calls.length, 0);
  });

  it('時刻表より駅定義を長くキャッシュさせる', async () => {
    const { fetchImpl } = upstream();
    const station = await handleProxyRequest(
      { path: '/odpt:Station', query: {}, method: 'GET' },
      { token: TOKEN, fetchImpl },
    );
    const timetable = await handleProxyRequest(
      { path: '/odpt:StationTimetable', query: {}, method: 'GET' },
      { token: TOKEN, fetchImpl },
    );

    assert.equal(station.headers['Cache-Control'], 'public, max-age=86400');
    assert.equal(timetable.headers['Cache-Control'], 'public, max-age=3600');
  });

  it('GET と OPTIONS 以外は 405', async () => {
    const { fetchImpl } = upstream();
    const response = await handleProxyRequest(
      { path: '/odpt:Station', query: {}, method: 'POST' },
      { token: TOKEN, fetchImpl },
    );
    assert.equal(response.status, 405);
  });
});

describe('上流が失敗したとき', () => {
  it('ODPT のエラー本文をそのまま返さない', async () => {
    // 本文にキーが載る可能性があるので、状態だけ伝える
    const { fetchImpl } = upstream({ message: 'key=secret is invalid' }, 403);
    const response = await handleProxyRequest(
      { path: '/odpt:Station', query: {}, method: 'GET' },
      { token: TOKEN, fetchImpl },
    );

    assert.equal(response.status, 502);
    assert.ok(!response.body.includes('secret'));
  });

  it('レート制限は 429 のまま伝える', async () => {
    const { fetchImpl } = upstream({}, 429);
    const response = await handleProxyRequest(
      { path: '/odpt:Station', query: {}, method: 'GET' },
      { token: TOKEN, fetchImpl },
    );
    assert.equal(response.status, 429);
  });

  it('到達できなければ 502', async () => {
    const fetchImpl = (() => Promise.reject(new Error('ENOTFOUND'))) as unknown as typeof fetch;
    const response = await handleProxyRequest(
      { path: '/odpt:Station', query: {}, method: 'GET' },
      { token: TOKEN, fetchImpl },
    );
    assert.equal(response.status, 502);
  });
});

describe('アプリ以外からの利用を防ぐ', () => {
  it('共有鍵が一致すれば通す', async () => {
    const { calls, fetchImpl } = upstream();
    const response = await handleProxyRequest(
      {
        path: '/odpt:Station',
        query: {},
        method: 'GET',
        headers: { [APP_KEY_HEADER]: APP_KEY },
      },
      { token: TOKEN, appKey: APP_KEY, fetchImpl },
    );

    assert.equal(response.status, 200);
    assert.equal(calls.length, 1);
  });

  it('鍵がなければ 403 にして上流に投げない', async () => {
    // ライセンスは「第三者が再利用可能な状態での公衆送信」を禁じている。
    // URL を知っただけで JSON が取れる状態にはしない。
    const { calls, fetchImpl } = upstream();
    const response = await handleProxyRequest(
      { path: '/odpt:Station', query: {}, method: 'GET' },
      { token: TOKEN, appKey: APP_KEY, fetchImpl },
    );

    assert.equal(response.status, 403);
    assert.equal(calls.length, 0);
  });

  it('鍵が違えば 403', async () => {
    const { fetchImpl } = upstream();
    const response = await handleProxyRequest(
      {
        path: '/odpt:Station',
        query: {},
        method: 'GET',
        headers: { [APP_KEY_HEADER]: 'wrong' },
      },
      { token: TOKEN, appKey: APP_KEY, fetchImpl },
    );
    assert.equal(response.status, 403);
  });

  it('鍵を設定していなければ検査しない（ローカル開発用）', async () => {
    const { fetchImpl } = upstream();
    const response = await handleProxyRequest(
      { path: '/odpt:Station', query: {}, method: 'GET' },
      { token: TOKEN, fetchImpl },
    );
    assert.equal(response.status, 200);
  });

  it('プリフライトは鍵なしでも通す（ブラウザが先に投げるため）', async () => {
    const { fetchImpl } = upstream();
    const response = await handleProxyRequest(
      { path: '/odpt:Station', query: {}, method: 'OPTIONS' },
      { token: TOKEN, appKey: APP_KEY, fetchImpl },
    );
    assert.equal(response.status, 204);
  });

  it('プリフライトで共有鍵ヘッダを許可する', async () => {
    const { fetchImpl } = upstream();
    const response = await handleProxyRequest(
      { path: '/odpt:Station', query: {}, method: 'OPTIONS' },
      { token: TOKEN, fetchImpl },
    );
    assert.match(response.headers['Access-Control-Allow-Headers'] ?? '', /X-Tokyojihatsu-Key/);
  });
});

describe('レート制限', () => {
  const base = 1_000_000;

  it('上限までは通し、超えたら 429', async () => {
    const { fetchImpl } = upstream();
    const call = (n: number) =>
      handleProxyRequest(
        { path: '/odpt:Station', query: {}, method: 'GET', sourceIp: '203.0.113.1' },
        { token: TOKEN, fetchImpl, rateLimitPerMinute: 3, now: () => base + n },
      );

    assert.equal((await call(0)).status, 200);
    assert.equal((await call(1)).status, 200);
    assert.equal((await call(2)).status, 200);
    const over = await call(3);
    assert.equal(over.status, 429);
    assert.equal(over.headers['Retry-After'], '60');
  });

  it('1 分経てば枠が戻る', async () => {
    const { fetchImpl } = upstream();
    const call = (at: number) =>
      handleProxyRequest(
        { path: '/odpt:Station', query: {}, method: 'GET', sourceIp: '203.0.113.2' },
        { token: TOKEN, fetchImpl, rateLimitPerMinute: 1, now: () => at },
      );

    assert.equal((await call(base)).status, 200);
    assert.equal((await call(base + 1)).status, 429);
    assert.equal((await call(base + 61_000)).status, 200);
  });

  it('IP ごとに数える', async () => {
    const { fetchImpl } = upstream();
    const call = (ip: string) =>
      handleProxyRequest(
        { path: '/odpt:Station', query: {}, method: 'GET', sourceIp: ip },
        { token: TOKEN, fetchImpl, rateLimitPerMinute: 1, now: () => base },
      );

    assert.equal((await call('203.0.113.3')).status, 200);
    assert.equal((await call('203.0.113.4')).status, 200);
    assert.equal((await call('203.0.113.3')).status, 429);
  });

  it('0 を指定すると無効になる', async () => {
    const { fetchImpl } = upstream();
    for (let i = 0; i < 5; i += 1) {
      const r = await handleProxyRequest(
        { path: '/odpt:Station', query: {}, method: 'GET', sourceIp: '203.0.113.5' },
        { token: TOKEN, fetchImpl, rateLimitPerMinute: 0, now: () => base },
      );
      assert.equal(r.status, 200);
    }
  });
});

describe('チャレンジ限定データの振り分け', () => {
  const CHALLENGE_TOKEN = 'challenge-only-token';

  it('/challenge/ はチャレンジ用エンドポイントとトークンを使う', async () => {
    // 通常の API では 0 件しか返らないので、取り違えると原因が分かりにくい
    const { calls, fetchImpl } = upstream();
    const response = await handleProxyRequest(
      { path: '/challenge/api/v4/odpt:StationTimetable', query: {}, method: 'GET' },
      { token: TOKEN, challengeToken: CHALLENGE_TOKEN, fetchImpl },
    );

    assert.equal(response.status, 200);
    const url = new URL(calls[0]!);
    assert.equal(url.host, 'api-challenge.odpt.org');
    assert.equal(url.searchParams.get('acl:consumerKey'), CHALLENGE_TOKEN);
  });

  it('通常のパスは基本ライセンス側を使う', async () => {
    const { calls, fetchImpl } = upstream();
    await handleProxyRequest(
      { path: '/api/v4/odpt:StationTimetable', query: {}, method: 'GET' },
      { token: TOKEN, challengeToken: CHALLENGE_TOKEN, fetchImpl },
    );

    const url = new URL(calls[0]!);
    assert.equal(url.host, 'api.odpt.org');
    assert.equal(url.searchParams.get('acl:consumerKey'), TOKEN);
  });

  it('チャレンジ用トークンが無ければ 404 にして上流に投げない', async () => {
    // 許諾が切れてトークンを消したあとも、この経路は静かに閉じる
    const { calls, fetchImpl } = upstream();
    const response = await handleProxyRequest(
      { path: '/challenge/api/v4/odpt:StationTimetable', query: {}, method: 'GET' },
      { token: TOKEN, fetchImpl },
    );

    assert.equal(response.status, 404);
    assert.equal(calls.length, 0);
  });
});

describe('列車位置と列車時刻表', () => {
  it('どちらも中継してよいデータ型に含む', async () => {
    for (const dataType of ['odpt:Train', 'odpt:TrainTimetable']) {
      const { fetchImpl } = upstream();
      const response = await handleProxyRequest(
        { path: `/${dataType}`, query: {}, method: 'GET' },
        { token: TOKEN, fetchImpl },
      );
      assert.equal(response.status, 200, dataType);
    }
  });

  it('列車位置は短くキャッシュする', async () => {
    // dct:valid が 5 分。古い位置を配り続けると
    // 「最新でなくなった情報を表示しない」に反する
    const { fetchImpl } = upstream();
    const train = await handleProxyRequest(
      { path: '/odpt:Train', query: {}, method: 'GET' },
      { token: TOKEN, fetchImpl },
    );
    assert.equal(train.headers['Cache-Control'], 'public, max-age=30');

    const timetable = await handleProxyRequest(
      { path: '/odpt:TrainTimetable', query: {}, method: 'GET' },
      { token: TOKEN, fetchImpl },
    );
    assert.equal(timetable.headers['Cache-Control'], 'public, max-age=3600');
  });

  it('列車番号での絞り込みを通す', async () => {
    const { calls, fetchImpl } = upstream();
    await handleProxyRequest(
      { path: '/odpt:TrainTimetable', query: { 'odpt:trainNumber': '601A' }, method: 'GET' },
      { token: TOKEN, fetchImpl },
    );
    assert.equal(new URL(calls[0]!).searchParams.get('odpt:trainNumber'), '601A');
  });
});
