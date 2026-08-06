/**
 * `npm run dream -- --project X [--force]`
 *
 * Runs the dream pipeline once from the terminal, against the same code path
 * the scheduler uses. Writes to Notion exactly as a nightly run would.
 */
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { config as loadEnv } from 'dotenv';
import { Client } from '@notionhq/client';
import cockpitConfig from '../../../../cockpit.config.ts';
import { describeNotionFailure, fatal, tokenSource } from '../boot.ts';
import { Bus } from '../bus.ts';
import { Store } from '../db.ts';
import { DreamPipeline, matches } from '../dream/pipeline.ts';
import { PortfolioService } from '../portfolio.ts';
import { Executor } from '../runtime/executor.ts';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const shellToken = process.env.NOTION_TOKEN;
loadEnv({ path: resolve(repoRoot, '.env'), quiet: true });

const { values } = parseArgs({
  options: {
    project: { type: 'string' },
    force: { type: 'boolean', default: false },
    max: { type: 'string' },
  },
  allowPositionals: true,
});

const notionToken = process.env.NOTION_TOKEN;
if (!notionToken) {
  fatal({
    message: 'NOTION_TOKEN is not set.',
    hint: 'cp .env.example .env and add your internal integration token, then: npm run preflight',
  });
}

const notion = new Client({ auth: notionToken });
const portfolioService = new PortfolioService(notion, cockpitConfig);
const store = new Store(repoRoot);

const schema = await portfolioService.init().catch((err: unknown) => {
  fatal(
    describeNotionFailure(err, {
      token: notionToken,
      source: tokenSource(shellToken, notionToken),
      registryDatabaseId: cockpitConfig.notion.registryDatabaseId,
    }),
  );
});

const { projects } = await portfolioService.load();

if (values.project && !projects.some((p) => matches(p, values.project!))) {
  console.error(
    `[cockpit] No registry row matches "${values.project}". Known projects: ` +
      projects.map((p) => p.name).join(', '),
  );
  process.exit(1);
}

// The bus needs no HTTP server here; nothing is listening during a CLI run.
const bus = { broadcast: () => undefined } as unknown as Bus;
const executor = new Executor(store, bus);
const pipeline = new DreamPipeline({ repoRoot, store, executor, notion, schema });

const outcomes = await pipeline.dreamAll(projects, {
  force: values.force,
  only: values.project,
  max: values.max ? Number(values.max) : cockpitConfig.dream.maxProjectsPerNight,
});

if (outcomes.length === 0) {
  console.log('[cockpit] Nothing to dream. Tick "Dream" on a registry row, or pass --project.');
}

let failures = 0;
for (const o of outcomes) {
  if (o.status === 'done') {
    console.log(`✓ ${o.project} — ${o.health} · run ${o.runId}`);
    console.log(`  Dream Log: https://notion.so/${o.dreamLogPageId.replace(/-/g, '')}`);
  } else if (o.status === 'skipped') {
    console.log(`· ${o.project} — skipped (${o.reason}). Use --force to override.`);
  } else {
    failures++;
    console.error(`✗ ${o.project} — ${o.reason}${o.runId ? ` · run ${o.runId}` : ''}`);
    console.error('  Surfaced in the CEO inbox as a failed dream.');
  }
}

process.exit(failures > 0 ? 1 : 0);
