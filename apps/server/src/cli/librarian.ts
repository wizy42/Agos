/**
 * `npm run librarian`
 *
 * Runs the weekly skill librarian once, from the terminal. Proposals are staged
 * in `skills-proposed/` for review — nothing is installed (§9).
 */
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { config as loadEnv } from 'dotenv';
import { Client } from '@notionhq/client';
import cockpitConfig from '../../../../cockpit.config.ts';
import { describeNotionFailure, fatal, tokenSource } from '../boot.ts';
import type { Bus } from '../bus.ts';
import { Store } from '../db.ts';
import { PortfolioService } from '../portfolio.ts';
import { Executor } from '../runtime/executor.ts';
import { Librarian } from '../skills/librarian.ts';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const shellToken = process.env.NOTION_TOKEN;
loadEnv({ path: resolve(repoRoot, '.env'), quiet: true });

const notionToken = process.env.NOTION_TOKEN;
if (!notionToken) {
  fatal({
    message: 'NOTION_TOKEN is not set.',
    hint: 'cp .env.example .env and add your internal integration token, then: npm run preflight',
  });
}

const notion = new Client({ auth: notionToken });
const portfolio = new PortfolioService(notion, cockpitConfig);

await portfolio.init().catch((err: unknown) => {
  fatal(
    describeNotionFailure(err, {
      token: notionToken,
      source: tokenSource(shellToken, notionToken),
      registryDatabaseId: cockpitConfig.notion.registryDatabaseId,
    }),
  );
});

const { projects } = await portfolio.load();

const store = new Store(repoRoot);
const bus = { broadcast: () => undefined } as unknown as Bus;
const executor = new Executor(store, bus);

const outcome = await new Librarian({ repoRoot, store, executor }).run(projects);

if (outcome.status === 'failed') {
  console.error(`✗ librarian failed: ${outcome.reason} · run ${outcome.runId}`);
  process.exit(1);
}

console.log(`\n${outcome.report.summary}\n`);

if (outcome.staged.length === 0) {
  console.log('No proposals. The librarian found nothing worth changing.');
} else {
  for (const p of outcome.staged) {
    console.log(`${p.kind.toUpperCase().padEnd(9)} ${p.name}`);
    console.log(`  ${p.why}`);
    if (p.stagedPath) console.log(`  staged: ${p.stagedPath}`);
  }
  console.log('\nReview them under Agents & Skills, then install or reject.');
  console.log('Nothing has been installed — a SKILL.md is instructions your agents will obey.');
}

for (const link of outcome.report.publicSkills) {
  console.log(`\n↗ ${link.name} — ${link.url}\n  ${link.why}`);
}

process.exit(0);
