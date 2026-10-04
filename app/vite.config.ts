import { defineConfig } from 'vite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const projectRoot = resolve(here, '..');

const lanIp = process.env.LAN_IP;

const appVersion = JSON.parse(
  readFileSync(new URL('./app.json', import.meta.url), 'utf8'),
).version as string;

export default defineConfig({
  define: {
    // 端末側の画面に版を出す。app.json を単一の出所にしておく。
    __APP_VERSION__: JSON.stringify(appVersion),
  },
  root: here,
  // ODPT のトークンはプロジェクト直下の .env から読む（VITE_ODPT_TOKEN）。
  envDir: projectRoot,
  build: {
    outDir: resolve(projectRoot, 'dist/app'),
    emptyOutDir: true,
    target: 'es2020',
    // 駅マスタ（440 駅・約 500KB）を同梱するので 500KB は超える。
    // .ehpk の実用上限は約 10MB なので問題にならない。
    chunkSizeWarningLimit: 1500,
  },
  server: {
    port: 5175,
    // ポートが埋まっていたら黙ってずらさない。QR が別のサーバーを
    // 指してしまう事故が起きるため（実際に別プロジェクトを読み込んだ）。
    strictPort: true,
    host: true,
    hmr: lanIp ? { host: lanIp } : undefined,
  },
});
