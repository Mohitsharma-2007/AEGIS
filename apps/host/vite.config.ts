import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { darkTheme } from './src/build/dark-theme';
export default defineConfig({
  plugins: [react()],
  define: {
    'process.env': JSON.stringify({ NODE_ENV: 'production' }),
    process: 'window.process',
    global: 'window',
  },
  css: { postcss: { plugins: [darkTheme()] } },
  // The suite must not leave the lazily spawned WhatsApp sidecar behind.
  test: { globalSetup: ['./tests/global-teardown.ts'] },
  build: { outDir: 'dist/client' },
  server: {
    strictPort: true,
    host: '127.0.0.1',
    proxy: { '/api': 'http://127.0.0.1:4310' },
  },
});
