import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { dataTypeFromPath, handleProxyRequest } from '../proxy/src/proxy.js';

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
