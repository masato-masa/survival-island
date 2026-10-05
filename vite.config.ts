import { fileURLToPath } from 'node:url';

import react from '@vitejs/plugin-react';
// vite の defineConfig は test フィールドを知らないので、vitest 側から取る。
import { defineConfig } from 'vitest/config';

// GitHub Pages はリポジトリ名のサブパスで配信される。リポジトリ名と必ず一致させること。
export default defineConfig({
  base: '/survival-island/',
  plugins: [react()],
  // refs/ は生成素材の置き場（画像を書き込み中に監視すると Windows で EBUSY になり開発サーバーが落ちる）
  server: { watch: { ignored: ['**/refs/**'] } },
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    include: ['__tests__/**/*.test.ts'],
  },
});
