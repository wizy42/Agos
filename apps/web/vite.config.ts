import { createLogger, defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const uiPort = Number(process.env.PORT ?? 4200);
const apiPort = uiPort + 1;

/*
 * When the API is down, the UI's `/ws` proxy retries every few seconds and Vite
 * prints a full stack each time. That spam is what you notice first, and it
 * points at the proxy rather than at the server error it is a symptom of — so
 * collapse it into one line, repeated at most once a minute.
 */
const logger = createLogger();
const baseError = logger.error.bind(logger);
let lastProxyError = 0;

logger.error = (msg, options) => {
  if (/proxy error/.test(msg) && /ECONNREFUSED/.test(msg)) {
    const now = Date.now();
    if (now - lastProxyError < 60_000) return;
    lastProxyError = now;
    baseError(
      `[cockpit] The API is not answering on 127.0.0.1:${apiPort} — the UI will keep ` +
        'retrying. See the [server] output for why. (Further proxy errors are suppressed ' +
        'for 60s.)',
      options,
    );
    return;
  }
  baseError(msg, options);
};

export default defineConfig({
  customLogger: logger,
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
