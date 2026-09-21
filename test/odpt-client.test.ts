import { strict as assert } from 'node:assert';
import { afterEach, describe, it } from 'node:test';

import { OdptClient, OdptError } from '../src/odpt/client.js';

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

/** 呼ばれたときの this と URL を記録する fetch。 */
function spyFetch(body: unknown = [], status = 200) {
  const calls: { url: string; thisArg: unknown }[] = [];
  globalThis.fetch = function (this: unknown, input: RequestInfo | URL) {
    calls.push({ url: String(input), thisArg: this });
    return Promise.resolve(
      new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
    );
  } as typeof fetch;
  return calls;
}

describe('ODPT クライアント', () => {
  it('fetch を window の this で呼ぶ', async () => {
    // 変数に代入した fetch をそのまま呼ぶと、ブラウザで
    // "Can only call Window.fetch on instances of Window" になる。
    // Node では落ちないので、this が付いていることを明示的に確かめる。
    const calls = spyFetch();
    await new OdptClient({ consumerKey: 'k' }).stations('odpt.Operator:Toei');

    assert.equal(calls.length, 1);
    assert.ok(
      calls[0]!.thisArg === globalThis || calls[0]!.thisArg === undefined,
      `this が ${String(calls[0]!.thisArg)} になっている`,
    );
  });

  it('事業者とキーをクエリに載せる', async () => {
    const calls = spyFetch();
    await new OdptClient({ consumerKey: 'secret' }).stations('odpt.Operator:Toei');

    const url = new URL(calls[0]!.url);
    assert.equal(url.pathname, '/api/v4/odpt:Station');
    assert.equal(url.searchParams.get('odpt:operator'), 'odpt.Operator:Toei');
    assert.equal(url.searchParams.get('acl:consumerKey'), 'secret');
  });

  it('baseUrl を差し替えるとプロキシ経由にできる', async () => {
    const calls = spyFetch();
    await new OdptClient({
      consumerKey: 'k',
      baseUrl: 'https://proxy.example.com/odpt/',
    }).railDirections();

    assert.ok(calls[0]!.url.startsWith('https://proxy.example.com/odpt/odpt:RailDirection'));
  });

  it('時刻表 ID をまとめて 1 リクエストで引く', async () => {
    const calls = spyFetch();
    await new OdptClient({ consumerKey: 'k' }).stationTimetablesById(['a', 'b']);

    assert.equal(new URL(calls[0]!.url).searchParams.get('owl:sameAs'), 'a,b');
  });

  it('ID が空なら通信しない', async () => {
    const calls = spyFetch();
    const result = await new OdptClient({ consumerKey: 'k' }).stationTimetablesById([]);

    assert.deepEqual(result, []);
    assert.equal(calls.length, 0);
  });

  it('HTTP エラーは status 付きで投げる', async () => {
    spyFetch({ message: 'no' }, 403);
    await assert.rejects(
      () => new OdptClient({ consumerKey: 'k' }).stations('odpt.Operator:Toei'),
      (error: unknown) => error instanceof OdptError && error.status === 403,
    );
  });
});
