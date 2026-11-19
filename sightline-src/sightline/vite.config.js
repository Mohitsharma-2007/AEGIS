import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { visionMiddleware } from './server/vision.js';

export default defineConfig({
  plugins: [react(), {
    name: 'sightline-vision',
    configureServer(server) { server.middlewares.use(visionMiddleware); },
    configurePreviewServer(server) { server.middlewares.use(visionMiddleware); },
  }],
  server: { host: '0.0.0.0', allowedHosts: true },
  preview: { host: '0.0.0.0', allowedHosts: true },
  build: {
    rollupOptions: { output: { manualChunks(id) { if (id.includes('/three/')) return 'three'; } } },
    chunkSizeWarningLimit: 650,
  },
});
