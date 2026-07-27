import { execFile } from 'node:child_process';
import { readdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import type { ProjectActivity } from '@cockpit/core';

const exec = promisify(execFile);

/** Expand a leading `~` and make the path absolute. */
export function expandPath(p: string): string {
  const expanded = p.startsWith('~') ? join(homedir(), p.slice(1)) : p;
  return resolve(expanded);
}

/** Read-only git probe. Any failure degrades to nulls rather than throwing. */
async function git(cwd: string, args: string[]): Promise<string | null> {
  try {
    const { stdout } = await exec('git', args, { cwd, timeout: 5000, windowsHide: true });
    return stdout.trim();
  } catch {
    return null;
  }
}

/**
 * Claude Code stores sessions under `~/.claude/projects/<encoded-cwd>/*.jsonl`,
 * where the encoding replaces every `/` with `-`.
 *
 * Best-effort only: the JSONL layout is internal and version-unstable, so this
 * reads mtimes and never parses contents. An activity signal, not a source of truth.
 */
async function lastSessionAt(repoPath: string): Promise<string | null> {
  const dir = join(homedir(), '.claude', 'projects', repoPath.replace(/\//g, '-'));
  try {
    const files = await readdir(dir);
    let newest = 0;
    for (const f of files) {
      if (!f.endsWith('.jsonl')) continue;
      const s = await stat(join(dir, f));
      if (s.mtimeMs > newest) newest = s.mtimeMs;
    }
    return newest ? new Date(newest).toISOString() : null;
  } catch {
    return null;
  }
}

export async function readActivity(rawRepoPath: string): Promise<ProjectActivity> {
  const repoPath = expandPath(rawRepoPath);

  const empty: ProjectActivity = {
    repoFound: false,
    branch: null,
    lastCommitAt: null,
    lastCommitSubject: null,
    dirty: false,
    lastSessionAt: null,
  };

  try {
    const s = await stat(repoPath);
    if (!s.isDirectory()) return empty;
  } catch {
    return empty;
  }

  const isRepo = (await git(repoPath, ['rev-parse', '--is-inside-work-tree'])) === 'true';
  if (!isRepo) {
    return { ...empty, repoFound: true, lastSessionAt: await lastSessionAt(repoPath) };
  }

  const [branch, log, porcelain, session] = await Promise.all([
    git(repoPath, ['rev-parse', '--abbrev-ref', 'HEAD']),
    git(repoPath, ['log', '-1', '--format=%cI%x00%s']),
    git(repoPath, ['status', '--porcelain']),
    lastSessionAt(repoPath),
  ]);

  const [commitAt, subject] = log ? log.split('\0') : [];

  return {
    repoFound: true,
    branch,
    lastCommitAt: commitAt || null,
    lastCommitSubject: subject || null,
    dirty: Boolean(porcelain),
    lastSessionAt: session,
  };
}
