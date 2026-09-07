import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { config as loadEnv } from 'dotenv';
import { Client } from '@notionhq/client';
import cockpitConfig from '../../../cockpit.config.ts';
import { buildApp, type Jobs } from './app.ts';
import {
  describeNotionFailure,
  describeStartupFailure,
  fatal,
  tokenSource,
} from './boot.ts';
import { Store } from './db.ts';
import { DreamPipeline } from './dream/pipeline.ts';
import { PortfolioService } from './portfolio.ts';
import { startLibrarian, startScheduler } from './scheduler.ts';
import { Librarian } from './skills/librarian.ts';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

// Read before dotenv runs: it never overrides an exported variable, so this is
// the only way to know whether .env is actually the file in charge.
const shellToken = process.env.NOTION_TOKEN;
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
  fatal({
    message: 'NOTION_TOKEN is not set.',
    hint:
      'cp .env.example .env, then add the internal integration token shared with\n' +
      'the "Convergence Labs Projects" hub page.\n' +
      'Then: npm run preflight',
  });
}

const source = tokenSource(shellToken, notionToken);
// `npm run dev` says this before spawning us; no need to say it twice.
if (source === 'shell' && !process.env.COCKPIT_DEV) {
  console.warn(
    '[cockpit] NOTION_TOKEN comes from your shell environment, not .env — an exported\n' +
      '          value wins over the file. Editing .env will have no effect until you\n' +
      '          `unset NOTION_TOKEN` in this shell.',
  );
}

// `tsx watch` keeps running after the script exits, so an unhandled rejection
// would otherwise leave a silent, non-serving process behind.
process.on('unhandledRejection', (reason) => {
  fatal(describeStartupFailure(reason, apiPort));
});

const notion = new Client({ auth: notionToken });
const portfolio = new PortfolioService(notion, cockpitConfig);

const schema = await portfolio.init().catch((err: unknown) => {
  fatal(
    describeNotionFailure(err, {
      token: notionToken,
      source,
      registryDatabaseId: cockpitConfig.notion.registryDatabaseId,
    }),
  );
});

if (schema.missing.length) {
  console.warn(
    `[cockpit] Registry properties not found: ${schema.missing.join(', ')}. ` +
      'Those fields will read as empty.',
  );
}

try {
  const store = new Store(repoRoot);

  // Both loops need the Executor that buildApp creates, so the routes reach
  // them through this holder, filled in a few lines below.
  let jobs: Jobs | null = null;
  const { app, executor } = buildApp({
    portfolio,
    store,
    repoRoot,
    jobs: () => jobs,
    registry: { notion, schema, hubPageId: cockpitConfig.notion.hubPageId },
  });

  const pipeline = new DreamPipeline({ repoRoot, store, executor, notion, schema });
  startScheduler({
    schedule: cockpitConfig.dream.schedule,
    maxProjectsPerNight: cockpitConfig.dream.maxProjectsPerNight,
    portfolio,
    pipeline,
  });

  const librarian = new Librarian({ repoRoot, store, executor });
  startLibrarian({ schedule: cockpitConfig.librarian.schedule, portfolio, librarian });

  jobs = {
    dream: (project, onRun) => pipeline.dream(project, { force: true, onRun }),
    librarian: (projects, onRun) => librarian.run(projects, { onRun }),
  };

  await app.listen({ port: apiPort, host: '127.0.0.1' });
  console.log(`[cockpit] api listening on http://localhost:${apiPort}`);
} catch (err) {
  fatal(describeStartupFailure(err, apiPort));
}
