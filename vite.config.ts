import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { localRuntimePlugin } from './server/local-runtime.mjs';

export default defineConfig({
  plugins: [react(), localRuntimePlugin()],
  base: './',
  server: {
    host: '127.0.0.1', port: 5173, strictPort: true, cors: false,
    headers: {
      'Content-Security-Policy': "frame-ancestors 'none'",
      'X-Frame-Options': 'DENY',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
    },
  },
  build: { chunkSizeWarningLimit: 600 },
});
