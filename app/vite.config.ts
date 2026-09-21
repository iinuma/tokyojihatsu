import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const projectRoot = resolve(here, '..');

const lanIp = process.env.LAN_IP;

export default defineConfig({
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
    host: true,
    hmr: lanIp ? { host: lanIp } : undefined,
  },
});
