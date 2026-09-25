import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));

/**
 * QR サイドロード（Local Testing）で実機から読むときは、dev サーバーを
 * LAN に出して HMR の戻り先も LAN IP にする必要がある。localhost のままだと
 * 電話側が laptop に繋ぎ返せず HMR が落ちる。
 *
 *   LAN_IP=$(ipconfig getifaddr en0) npm run probe:dev
 */
const lanIp = process.env.LAN_IP;

export default defineConfig({
  root: here,
  build: {
    outDir: resolve(here, '../dist/mapprobe'),
    emptyOutDir: true,
    target: 'es2020',
  },
  server: {
    port: 5176,
    // ポートが埋まっていたら黙ってずらさない。QR が別のサーバーを
    // 指してしまう事故が起きるため（実際に別プロジェクトを読み込んだ）。
    strictPort: true,
    host: true,
    hmr: lanIp ? { host: lanIp } : undefined,
  },
});
