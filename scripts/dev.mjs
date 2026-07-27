#!/usr/bin/env node
/**
 * `pnpm dev` — starts the API server and the Vite dev server together,
 * then prints the one URL that matters.
 */
import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadEnv } from 'dotenv';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
loadEnv({ path: resolve(root, '.env'), quiet: true });

const uiPort = Number(process.env.PORT ?? 4200);
const apiPort = uiPort + 1;

// Fail fast here rather than inside `tsx watch`, which keeps the watcher alive
// after the server exits and would leave `pnpm dev` hanging silently.
if (!process.env.NOTION_TOKEN) {
  console.error(
    '\n[cockpit] NOTION_TOKEN is not set.\n' +
      '          cp .env.example .env, then add the internal integration token\n' +
      '          shared with the "Convergence Labs Projects" hub page.\n',
  );
  process.exit(1);
}

const children = [];
let shuttingDown = false;

function run(name, cwd) {
  const child = spawn('pnpm', ['run', 'dev'], {
    cwd: resolve(root, cwd),
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PORT: String(uiPort), FORCE_COLOR: '1' },
  });

  const prefix = `\x1b[2m[${name}]\x1b[0m `;
  const pipe = (stream, out) => {
    stream.setEncoding('utf8');
    let buf = '';
    stream.on('data', (chunk) => {
      buf += chunk;
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';
      for (const line of lines) out.write(prefix + line + '\n');
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

function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const c of children) c.kill('SIGTERM');
  process.exit(code);
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

run('server', 'apps/server');
run('web', 'apps/web');

// Only advertise the UI once the API actually answers.
let healthy = false;
const deadline = Date.now() + 30_000;
while (Date.now() < deadline && !shuttingDown && !healthy) {
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
} else {
  console.error(
    `\n[cockpit] The API did not come up on port ${apiPort}. See the [server] output above.\n`,
  );
}
