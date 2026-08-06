#!/usr/bin/env node
/**
  * `npm run preflight` — checks everything Cockpit needs, fixes what it safely can, and
 * names exactly what is left for you.
 *
 * Re-runnable. The only thing it cannot do is create your Notion integration.
 */
import { execFile } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { config as loadEnv } from 'dotenv';

const exec = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// Captured before dotenv runs: it never overrides an exported variable, so a
// stale `export NOTION_TOKEN=…` silently wins over the .env being edited.
const shellToken = process.env.NOTION_TOKEN;
const tokenOrigin = () => (shellToken ? 'your shell environment' : '.env');

const g = (s) => `\x1b[32m${s}\x1b[0m`;
const r = (s) => `\x1b[31m${s}\x1b[0m`;
const y = (s) => `\x1b[33m${s}\x1b[0m`;
const dim = (s) => `\x1b[2m${s}\x1b[0m`;

const results = [];
const ok = (label, detail) => results.push({ state: 'ok', label, detail });
const warn = (label, detail, fix) => results.push({ state: 'warn', label, detail, fix });
const fail = (label, detail, fix) => results.push({ state: 'fail', label, detail, fix });

async function run(cmd, args) {
  try {
    const { stdout } = await exec(cmd, args, { timeout: 15_000 });
    return stdout.trim();
  } catch {
    return null;
  }
}

/* -------------------------------- runtime -------------------------------- */

const major = Number(process.versions.node.split('.')[0]);
if (major >= 22) ok('Node', `v${process.versions.node}`);
else fail('Node', `v${process.versions.node}`, 'Cockpit needs Node 22 or newer.');

const claude = await run('claude', ['-v']);
if (claude) ok('Claude Code CLI', claude);
else
  fail(
    'Claude Code CLI',
    'not found on PATH',
    'Install it and run `claude auth login` — agents run through that session.',
  );

/*
 * Agents bill against whatever the Claude Code binary is authenticated as.
 * Subscription auth is an OAuth login; an API key silently overrides it and
 * bills API credits instead. Ask the CLI rather than inferring.
 */
if (claude) {
  const raw = await run('claude', ['auth', 'status']);
  let status = null;
  try {
    status = JSON.parse(raw ?? '');
  } catch {
    /* older CLI, or non-JSON output */
  }

  if (!status) {
    warn('Claude auth', 'could not read status', 'Run `claude auth status` yourself to check.');
  } else if (!status.loggedIn) {
    fail('Claude auth', 'not logged in', 'Run `claude auth login` and sign in to your account.');
  } else if (status.authMethod === 'oauth_token') {
    ok('Claude auth', `subscription (oauth, ${status.apiProvider ?? 'firstParty'})`);
  } else {
    warn(
      'Claude auth',
      `authMethod=${status.authMethod}`,
      'This is not subscription auth — runs will bill API credits.\n' +
        '      Run `claude auth login` to switch to your Claude subscription.',
    );
  }
}

/*
 * The API key can hide in three places, and the two non-obvious ones are why
 * "I unset it in my shell" is not the same as "it is unset".
 */
const keySources = [];
if (process.env.ANTHROPIC_API_KEY) keySources.push('your shell environment');

const claudeSettings = join(homedir(), '.claude', 'settings.json');
if (existsSync(claudeSettings)) {
  try {
    const settings = JSON.parse(readFileSync(claudeSettings, 'utf8'));
    if (settings?.env?.ANTHROPIC_API_KEY) keySources.push(`the env block of ${claudeSettings}`);
    if (settings?.apiKeyHelper) keySources.push(`apiKeyHelper in ${claudeSettings}`);
  } catch {
    /* unreadable settings */
  }
}

const dotenvPath = join(root, '.env');
if (existsSync(dotenvPath)) {
  const body = readFileSync(dotenvPath, 'utf8');
  if (/^\s*ANTHROPIC_API_KEY\s*=\s*\S/m.test(body)) keySources.push('.env in this repo');
}

if (keySources.length) {
  warn(
    'ANTHROPIC_API_KEY',
    `set in ${keySources.join(', ')}`,
    'Remove it. When present it overrides your subscription and bills API credits instead.',
  );
} else {
  ok('ANTHROPIC_API_KEY', 'not set anywhere — subscription auth will be used');
}

/* ---------------------------------- .env ---------------------------------- */

const envPath = join(root, '.env');
if (!existsSync(envPath)) {
  writeFileSync(envPath, readFileSync(join(root, '.env.example'), 'utf8'));
  warn('.env', 'created from .env.example', 'Open it and paste your NOTION_TOKEN.');
} else {
  ok('.env', 'present');
}

loadEnv({ path: envPath, quiet: true });

const token = process.env.NOTION_TOKEN;
const tokenLooksReal = token && !token.startsWith('ntn_xxxx');

if (!tokenLooksReal) {
  fail(
    'NOTION_TOKEN',
    'missing or still the placeholder',
    'Create an integration at https://www.notion.so/profile/integrations with Read + Update + Insert,\n' +
      '      then connect it to the "Convergence Labs Projects" page via ··· → Connections.',
  );
} else if (shellToken) {
  warn(
    'NOTION_TOKEN',
    `set (${token.slice(0, 8)}…) from your shell environment`,
    'An exported NOTION_TOKEN wins over .env — editing the file will do nothing.\n' +
      '      `unset NOTION_TOKEN` (and remove it from ~/.zshrc) unless that is deliberate.',
  );
} else {
  ok('NOTION_TOKEN', `set (${token.slice(0, 8)}…)`);
}

/* ------------------------------- repo paths ------------------------------- */

const configPath = join(root, 'cockpit.config.ts');
let config = readFileSync(configPath, 'utf8');
const PLACEHOLDER = '~/dev/launchpad';

const expand = (p) => (p.startsWith('~') ? join(homedir(), p.slice(1)) : p);

const configured = [...config.matchAll(/repoPath:\s*'([^']+)'/g)].map((m) => m[1]);
for (const path of configured) {
  const full = expand(path);
  if (existsSync(join(full, '.git'))) {
    ok('Repo path', `${path} → found`);
  } else if (path === PLACEHOLDER) {
    // Try to locate the real clone and write it in.
    const found = await run('bash', [
      '-c',
      `find ~ -maxdepth 5 -type d -name .git -ipath '*launchpad*' 2>/dev/null | head -1`,
    ]);

    if (found) {
      const realPath = dirname(found).replace(homedir(), '~');
      config = config.replace(`'${PLACEHOLDER}'`, `'${realPath}'`);
      writeFileSync(configPath, config);
      ok('Repo path', `detected and set to ${realPath}`);
    } else {
      fail(
        'Repo path',
        `still the placeholder ${PLACEHOLDER}`,
        'Clone it (git clone https://github.com/wizy42/Launchpad) then re-run,\n' +
          '      or edit repoPath in cockpit.config.ts by hand.',
      );
    }
  } else {
    fail('Repo path', `${path} does not exist`, 'Fix repoPath in cockpit.config.ts.');
  }
}

/* ------------------------------ notion access ----------------------------- */

if (tokenLooksReal) {
  const dbId = /registryDatabaseId:\s*'([^']+)'/.exec(config)?.[1];
  try {
    const res = await fetch(`https://api.notion.com/v1/databases/${dbId}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        'Notion-Version': '2025-09-03',
      },
    });

    if (res.ok) {
      const db = await res.json();
      const sources = db.data_sources?.length ?? 0;
      ok('Notion registry', `reachable, ${sources} data source(s)`);
    } else if (res.status === 404) {
      fail(
        'Notion registry',
        '404 — the integration cannot see the database',
        'This almost always means the hub page is not shared with the integration.\n' +
          '      Open "Convergence Labs Projects" → ··· → Connections → add your integration.',
      );
    } else if (res.status === 401) {
      fail(
        'Notion registry',
        '401 — the token was rejected',
        `The token in use came from ${tokenOrigin()}. Tokens stop working when the\n` +
          '      integration is deleted or rotated — copy a current one from\n' +
          '      https://www.notion.so/profile/integrations.',
      );
    } else {
      fail('Notion registry', `HTTP ${res.status}`, (await res.text()).slice(0, 200));
    }
  } catch (err) {
    fail('Notion registry', `request failed: ${err.message}`, 'Check your network.');
  }
}

/* --------------------------------- report --------------------------------- */

console.log('');
for (const item of results) {
  const mark = item.state === 'ok' ? g('✓') : item.state === 'warn' ? y('!') : r('✗');
  console.log(`  ${mark} ${item.label.padEnd(20)} ${dim(item.detail)}`);
  if (item.fix) console.log(`      ${item.fix}`);
}

const failures = results.filter((i) => i.state === 'fail').length;
console.log('');

if (failures === 0) {
  console.log(`  ${g('Ready.')} Next:\n`);
  console.log('    npm run dev                                # → http://localhost:4200');
  console.log('    npm run dream -- --project LaunchPad --force  # the first real Notion write\n');
} else {
  console.log(`  ${r(`${failures} thing(s) left`)} — fix the ✗ lines above, then re-run npm run preflight.\n`);
}

process.exit(failures === 0 ? 0 : 1);
