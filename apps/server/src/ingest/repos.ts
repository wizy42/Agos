import { execFile } from 'node:child_process';
import { readdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

const exec = promisify(execFile);

/**
 * Finds a local clone by its git remote rather than by name.
 *
 * Names do not work here. BotAI's repository is `autobot33`; the project and
 * the directory share no letters worth matching on. A remote URL is the one
 * identity a clone carries that is the same on every machine, and the
 * portfolio's page template records exactly that in its Repo & Deploy table.
 */

/** `github.com/owner/repo`, whatever form the remote was written in. */
export function normalizeRemote(url: string): string | null {
  const trimmed = url.trim();
  if (!trimmed) return null;

  // git@github.com:owner/repo.git
  const scp = /^[\w.-]+@([\w.-]+):(.+?)(?:\.git)?\/?$/.exec(trimmed);
  if (scp) return `${scp[1]!.toLowerCase()}/${scp[2]!.toLowerCase()}`;

  // https://github.com/owner/repo(.git), ssh://git@github.com/owner/repo
  try {
    const u = new URL(trimmed);
    const path = u.pathname.replace(/^\/+/, '').replace(/\.git$/, '').replace(/\/+$/, '');
    if (!path) return null;
    return `${u.hostname.toLowerCase()}/${path.toLowerCase()}`;
  } catch {
    return null;
  }
}

/** The first GitHub repository URL in a block of text, or null. */
export function githubUrlIn(text: string): string | null {
  const m = /https?:\/\/github\.com\/[\w.-]+\/[\w.-]+/i.exec(text);
  if (!m) return null;
  // A trailing `.` or `)` from prose punctuation is not part of the name.
  return m[0].replace(/[.)]+$/, '');
}

async function originOf(dir: string): Promise<string | null> {
  try {
    const { stdout } = await exec('git', ['-C', dir, 'config', '--get', 'remote.origin.url'], {
      timeout: 5000,
    });
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

/** Directories that are never where a clone lives, and are expensive to walk. */
const SKIP = new Set([
  'node_modules',
  '.git',
  '.cache',
  '.npm',
  '.pnpm-store',
  '.cargo',
  '.rustup',
  '.local',
  '.Trash',
  'Library',
  'Applications',
  'snap',
  'go',
  '.vscode',
  '.claude',
]);

/**
 * Walks `roots` to `maxDepth` looking for a clone whose origin matches.
 * Returns the first match, or null.
 */
export async function findCloneByRemote(
  remote: string,
  roots: string[] = [homedir()],
  maxDepth = 4,
): Promise<string | null> {
  const wanted = normalizeRemote(remote);
  if (!wanted) return null;

  const queue: { dir: string; depth: number }[] = roots.map((r) => ({ dir: resolve(r), depth: 0 }));

  while (queue.length) {
    const { dir, depth } = queue.shift()!;

    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch {
      continue;
    }

    if (entries.includes('.git')) {
      const origin = await originOf(dir);
      if (origin && normalizeRemote(origin) === wanted) return dir;
      // A clone's subdirectories are never another clone worth finding.
      continue;
    }

    if (depth >= maxDepth) continue;

    for (const name of entries) {
      if (SKIP.has(name) || (name.startsWith('.') && name !== '.git')) continue;
      const full = join(dir, name);
      try {
        if ((await stat(full)).isDirectory()) queue.push({ dir: full, depth: depth + 1 });
      } catch {
        // unreadable entry
      }
    }
  }

  return null;
}
