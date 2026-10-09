/**
 * `npm run president [-- --focus LaunchPad]`
 *
 * Runs the weekly President pass once, from the terminal. The report is
 * appended to the Portfolio Log in Notion and dropped into the CEO inbox.
 */
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { config as loadEnv } from 'dotenv';
import { Client } from '@notionhq/client';
import cockpitConfig from '../../../../cockpit.config.ts';
import { describeNotionFailure, fatal, tokenSource } from '../boot.ts';
import type { Bus } from '../bus.ts';
import { Store } from '../db.ts';
import { PortfolioService } from '../portfolio.ts';
import { President } from '../president/pipeline.ts';
import { Executor } from '../runtime/executor.ts';

const { values } = parseArgs({
  options: { focus: { type: 'string' } },
  allowPositionals: false,
});

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

const president = new President({
  repoRoot,
  store,
  executor,
  notion,
  hubPageId: cockpitConfig.notion.hubPageId,
});

console.log(
  values.focus
    ? `President pass over ${projects.length} projects, focused on ${values.focus}…`
    : `President pass over ${projects.length} projects…`,
);

const outcome = await president.run(projects, { focus: values.focus });

if (outcome.status === 'failed') {
  console.error(`✗ president failed: ${outcome.reason} · run ${outcome.runId}`);
  process.exit(1);
}

const report = store.listPortfolioReports()[0]!.report;
console.log(`\n${report.health.toUpperCase()} — ${report.where_we_are}\n`);
for (const d of report.dimensions) {
  console.log(`${d.dimension.padEnd(10)} ${d.where_we_are}`);
  for (const m of d.missing) console.log(`           · missing: ${m}`);
}
console.log('\nPriorities:');
report.priorities.forEach((p, i) => {
  console.log(`${i + 1}. ${p.title} — ${p.project} (${p.agent})`);
  console.log(`   ${p.why}`);
});
if (report.questions_for_ceo.length) {
  console.log('\nQuestions for you:');
  for (const q of report.questions_for_ceo) console.log(`· ${q}`);
}
console.log('\nAppended to the Portfolio Log under the hub page; also in the CEO inbox.');

process.exit(0);
