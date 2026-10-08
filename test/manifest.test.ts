import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');

interface Manifest {
  version: string;
  permissions: { name: string; desc: string; whitelist?: string[] }[];
}

const manifest: Manifest = JSON.parse(readFileSync(resolve(ROOT, 'app/app.json'), 'utf8'));

function whitelist(): string[] {
  return manifest.permissions.find((p) => p.name === 'network')?.whitelist ?? [];
}

/** ビルド成果物があれば、その中の URL を全部拾う。無ければ空。 */
function bundledUrls(): string[] {
  const dir = resolve(ROOT, 'dist/app');
  let files: string[];
  try {
    files = [
      resolve(dir, 'index.html'),
      ...readdirSync(resolve(dir, 'assets')).map((f) => resolve(dir, 'assets', f)),
    ];
  } catch {
    return [];
  }

  const found = new Set<string>();
  for (const file of files) {
    let text: string;
    try {
      text = readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    for (const match of text.matchAll(/https?:\/\/[a-zA-Z0-9._~:/?#@!$&'()*+,;=%-]+/g)) {
      found.add(match[0]);
    }
  }
  return [...found];
}

describe('app.json の許可リスト', () => {
  it('バンドルに出てくる URL は全部ホワイトリストに含まれる', () => {
    // 審査で 2 度指摘された。1 度目は OdptClient の既定値として残っていた
    // api.odpt.org、2 度目は端末側画面に足したプライバシーポリシーのリンク。
    // **接続するかどうかに関わらず、.ehpk に文字列が残れば指摘される。**
    const urls = bundledUrls();
    if (urls.length === 0) {
      console.log('  (dist/app が無いので省略。npm run app:build 後に有効)');
      return;
    }

    const allowed = whitelist();
    for (const url of urls) {
      const ok = allowed.some((entry) => url.startsWith(entry));
      assert.ok(ok, `許可リストに無い URL がバンドルにある: ${url}\n  許可: ${allowed.join(', ')}`);
    }
  });

  it('ネットワーク権限には説明が付いている', () => {
    const network = manifest.permissions.find((p) => p.name === 'network');
    assert.ok(network, 'network 権限がある');
    assert.ok((network.desc ?? '').length > 20, '用途の説明がある');
    assert.ok(whitelist().length > 0, '接続先が列挙されている');
  });

  it('版は x.y.z の形', () => {
    assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
  });
});
