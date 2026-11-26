import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// VITE_TARGET=web|toss 에 따라 src/platform 구현을 바꿔 끼운다.
const target = process.env.VITE_TARGET === 'toss' ? 'toss' : 'web';

export default defineConfig({
  base: process.env.VITE_ROUTER_BASE ?? '/',
  plugins: [react()],
  resolve: {
    alias: { '@platform': fileURLToPath(new URL(`./src/platform/${target}.ts`, import.meta.url)) },
  },
  server: { proxy: { '/api': 'http://localhost:8080' } },
});
