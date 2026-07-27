import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { config as loadEnv } from 'dotenv';
import Fastify from 'fastify';
import { Client } from '@notionhq/client';
import cockpitConfig from '../../../cockpit.config.ts';
import { PortfolioService } from './portfolio.ts';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
loadEnv({ path: resolve(repoRoot, '.env'), quiet: true });

const uiPort = Number(process.env.PORT ?? 4200);
const apiPort = uiPort + 1;

if (process.env.ANTHROPIC_API_KEY) {
  console.warn(
    '[cockpit] ANTHROPIC_API_KEY is set. It silently overrides Claude Code subscription\n' +
      '          auth and bills API credits instead. Unset it unless that is deliberate.',
  );
}

const notionToken = process.env.NOTION_TOKEN;
if (!notionToken) {
  console.error(
    '[cockpit] NOTION_TOKEN is not set. Copy .env.example to .env and add the internal\n' +
      '          integration token shared with the "Convergence Labs Projects" hub page.',
  );
  process.exit(1);
}

const notion = new Client({ auth: notionToken });
const portfolio = new PortfolioService(notion, cockpitConfig);

const app = Fastify({ logger: false });

app.get('/api/health', async () => ({ ok: true }));

app.get('/api/portfolio', async (_req, reply) => {
  try {
    return await portfolio.load();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    reply.code(502);
    return { error: 'notion_unavailable', message };
  }
});

const schema = await portfolio.init().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`[cockpit] Could not read the Cockpit Registry: ${message}`);
  process.exit(1);
});

if (schema.missing.length) {
  console.warn(
    `[cockpit] Registry properties not found: ${schema.missing.join(', ')}. ` +
      'Those fields will read as empty.',
  );
}

await app.listen({ port: apiPort, host: '127.0.0.1' });
console.log(`[cockpit] api listening on http://localhost:${apiPort}`);
