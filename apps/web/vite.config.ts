import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const uiPort = Number(process.env.PORT ?? 4200);
const apiPort = uiPort + 1;

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: uiPort,
    strictPort: true,
    proxy: {
      '/api': { target: `http://127.0.0.1:${apiPort}`, changeOrigin: true },
      '/ws': { target: `ws://127.0.0.1:${apiPort}`, ws: true },
    },
  },
});
