#!/usr/bin/env node
/**
 * `npm run dev` — starts the API server and the Vite dev server together,
 * then prints the one URL that matters.
 *
 * Most of the code below is about failing loudly. `tsx watch` does not exit
 * when the server it runs exits — it waits for a file change — so a server that
 * died at boot looks exactly like a server that is still starting. Left alone,
 * the loudest thing on screen is Vite retrying its proxy against a port nothing
 * is listening on, which says nothing about the actual cause.
 */
import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadEnv } from 'dotenv';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const shellToken = process.env.NOTION_TOKEN;
loadEnv({ path: resolve(root, '.env'), quiet: true });

const uiPort = Number(process.env.PORT ?? 4200);
const apiPort = uiPort + 1;

/** Kept in sync with `FATAL_PREFIX` in apps/server/src/boot.ts. */
const FATAL_PREFIX = '[cockpit] fatal:';

/** Same shape the server uses: one sentence, then the fix, indented under it. */
function die(message, hint) {
  const indented = hint
    .split('\n')
    .map((line) => ' '.repeat('[cockpit] '.length) + line)
    .join('\n');
  console.error(`\n[cockpit] ${message}\n${indented}\n`);
  process.exit(1);
}

// Fail fast here rather than inside `tsx watch`, which keeps the watcher alive
// after the server exits and would leave `npm run dev` hanging silently.
if (!process.env.NOTION_TOKEN) {
  die(
    'NOTION_TOKEN is not set.',
    'cp .env.example .env, then add the internal integration token\n' +
      'shared with the "Convergence Labs Projects" hub page.',
  );
}

if (shellToken) {
  console.warn(
    '[cockpit] NOTION_TOKEN comes from your shell environment, not .env — an exported\n' +
      '          value wins over the file. Editing .env will have no effect until you\n' +
      '          `unset NOTION_TOKEN` in this shell.',
  );
}

/*
 * One cheap round-trip before spawning anything. A revoked or mistyped token is
 * the most common way `npm run dev` fails, and catching it here means the first
 * line on screen is the fix — not two subprocesses and a wall of proxy errors.
 * Anything other than a definitive 401 is left to the server to report: being
 * offline should not stop you from booting the UI.
 */
try {
  const res = await fetch('https://api.notion.com/v1/users/me', {
    headers: {
      Authorization: `Bearer ${process.env.NOTION_TOKEN}`,
      'Notion-Version': '2025-09-03',
    },
    signal: AbortSignal.timeout(10_000),
  });

  if (res.status === 401) {
    const token = process.env.NOTION_TOKEN;
    die(
      `Notion rejected NOTION_TOKEN (${token.slice(0, 8)}…) as invalid.`,
      `It was read from ${shellToken ? 'your shell environment' : '.env in this repo'}.\n` +
        'Create an internal integration at https://www.notion.so/profile/integrations\n' +
        '(Read + Update + Insert), copy the token — it starts with "ntn_" — and paste\n' +
        'it into .env. Tokens stop working when the integration is deleted or rotated.\n' +
        'Then: npm run preflight',
    );
  }
} catch {
  // Offline, or Notion is slow. The server reports it properly if it matters.
}

// npm ships with Node; `npm.cmd` is the Windows shim.
const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';

const children = [];
let shuttingDown = false;
let bootFailed = false;

function run(name, cwd) {
  const child = spawn(npmCmd, ['run', 'dev'], {
    cwd: resolve(root, cwd),
    stdio: ['ignore', 'pipe', 'pipe'],
    // COCKPIT_DEV tells the server this orchestrator already printed the
    // environment warnings, so they do not appear twice.
    env: { ...process.env, PORT: String(uiPort), FORCE_COLOR: '1', COCKPIT_DEV: '1' },
    // Own process group, so shutdown reaches vite/tsx and not just the npm shim.
    detached: process.platform !== 'win32',
  });

  const prefix = `\x1b[2m[${name}]\x1b[0m `;
  const pipe = (stream, out) => {
    stream.setEncoding('utf8');
    let buf = '';
    stream.on('data', (chunk) => {
      buf += chunk;
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';
      for (const line of lines) {
        // The server prints this instead of exiting quietly under `tsx watch`.
        if (name === 'server' && line.includes(FATAL_PREFIX)) bootFailed = true;
        out.write(prefix + line + '\n');
      }
    });
  };
  pipe(child.stdout, process.stdout);
  pipe(child.stderr, process.stderr);

  child.on('exit', (code) => {
    if (shuttingDown) return;
    console.error(`\n[cockpit] ${name} exited with code ${code}. Shutting down.`);
    shutdown(code ?? 1);
  });

  children.push(child);
}

function stop(child) {
  try {
    // Negative pid signals the whole group; falls back for Windows and for a
    // child that has already gone.
    if (child.pid && process.platform !== 'win32') process.kill(-child.pid, 'SIGTERM');
    else child.kill('SIGTERM');
  } catch {
    child.kill('SIGTERM');
  }
}

function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const c of children) stop(c);
  process.exit(code);
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

run('server', 'apps/server');
run('web', 'apps/web');

// Only advertise the UI once the API actually answers.
let healthy = false;
const deadline = Date.now() + 30_000;
while (Date.now() < deadline && !shuttingDown && !healthy && !bootFailed) {
  try {
    const res = await fetch(`http://127.0.0.1:${apiPort}/api/health`);
    healthy = res.ok;
  } catch {
    // not up yet
  }
  if (!healthy) await new Promise((r) => setTimeout(r, 250));
}

if (shuttingDown) {
  // nothing to say; the exit handler already reported why
} else if (healthy) {
  console.log(`\n  \x1b[1mCockpit\x1b[0m  →  \x1b[36mhttp://localhost:${uiPort}\x1b[0m\n`);
} else if (bootFailed) {
  // Give the server's own hint lines a moment to land above this.
  await new Promise((r) => setTimeout(r, 200));
  console.error('\n[cockpit] The API server could not start. Fix the [server] error above, then run npm run dev again.\n');
  shutdown(1);
} else {
  console.error(
    `\n[cockpit] The API did not come up on port ${apiPort} within 30s. See the [server]\n` +
      '          output above, or run npm run preflight. Shutting down.\n',
  );
  shutdown(1);
}
