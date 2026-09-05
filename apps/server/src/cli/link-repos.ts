/**
 * `npm run link-repos`
 *
 * For every registry project without a working repo path on this machine:
 * read its Notion page for the GitHub URL, find the local clone whose git
 * remote matches, and write that path back into the registry row.
 *
 * Matching by remote is the point. Directory names are useless — BotAI's
 * repository is `autobot33` — but a remote is the same on every machine, and
 * the portfolio's page template records it in the Repo & Deploy table.
 *
 * Never clones anything. Where no clone exists it prints the command.
 */
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { homedir } from 'node:os';
import { config as loadEnv } from 'dotenv';
import { Client } from '@notionhq/client';
import cockpitConfig from '../../../../cockpit.config.ts';
import { findCloneByRemote, githubUrlIn } from '../ingest/repos.ts';
import { readProjectPage } from '../notion/projectPage.ts';
import { normalizeNotionId, writeRepoPath } from '../notion/registry.ts';
import { PortfolioService } from '../portfolio.ts';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
loadEnv({ path: resolve(repoRoot, '.env'), quiet: true });

const g = (s: string) => `\x1b[32m${s}\x1b[0m`;
const y = (s: string) => `\x1b[33m${s}\x1b[0m`;
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;

const token = process.env.NOTION_TOKEN;
if (!token) {
  console.error('[cockpit] NOTION_TOKEN is not set. Run `npm run preflight`.');
  process.exit(1);
}

const notion = new Client({ auth: token });
const portfolio = new PortfolioService(notion, cockpitConfig);

const schema = await portfolio.init().catch((err: unknown) => {
  console.error(`[cockpit] Could not read the Cockpit Registry: ${(err as Error).message}`);
  process.exit(1);
});

const { projects } = await portfolio.load();

/** A URL from the config override for this project's page, if any. */
function configuredUrl(projectPageUrl: string | null): string | null {
  if (!projectPageUrl) return null;
  const id = normalizeNotionId(projectPageUrl);
  const entry = cockpitConfig.projects.find((p) => normalizeNotionId(p.notionPageId) === id);
  return entry?.repoUrl ?? null;
}

let linked = 0;
let missing = 0;
const toClone: string[] = [];

console.log(`\nScanning ${dim(homedir())} for clones of ${projects.length} registry projects…\n`);

for (const project of projects) {
  const label = project.name.padEnd(18);

  if (project.repoPath && project.activity?.repoFound) {
    console.log(`  ${g('✓')} ${label} ${dim(project.repoPath)}`);
    continue;
  }

  // The page first — that is where the template keeps the URL — then config.
  let url: string | null = null;
  const pageId = project.projectPageUrl ? normalizeNotionId(project.projectPageUrl) : null;
  if (pageId) {
    const page = await readProjectPage(notion, pageId).catch(() => ({ text: null, sections: [] }));
    url = page.text ? githubUrlIn(page.text) : null;
  }
  url ??= configuredUrl(project.projectPageUrl);

  if (!url) {
    missing++;
    console.log(`  ${y('·')} ${label} ${dim('no GitHub URL on its Notion page or in cockpit.config.ts')}`);
    continue;
  }

  const clone = await findCloneByRemote(url);
  if (clone) {
    await writeRepoPath(notion, schema, project.id, clone);
    linked++;
    console.log(`  ${g('✓')} ${label} ${dim('→')} ${clone}  ${dim('(written to registry)')}`);
  } else {
    missing++;
    const slug = url.split('/').pop() ?? project.name;
    toClone.push(`git clone ${url} ~/code/${slug}`);
    console.log(`  ${y('✗')} ${label} ${dim(`no clone of ${url} found`)}`);
  }
}

console.log('');
if (linked) console.log(`  ${g(`${linked} linked`)} — paths are now in the Cockpit Registry.`);
if (toClone.length) {
  console.log(`  ${y(`${toClone.length} not cloned`)} — to bring them in:\n`);
  for (const cmd of toClone) console.log(`    ${cmd}`);
  console.log(`\n  then re-run ${dim('npm run link-repos')}.`);
}
if (!linked && !toClone.length && missing) {
  console.log(`  Nothing to link. Add a Repo & Deploy table to the pages above, or a repoUrl in cockpit.config.ts.`);
}
console.log('');
process.exit(0);
