import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { RunChanges } from '@cockpit/core';

const exec = promisify(execFile);

/** Beyond this a diff is a download, not a screen. */
const MAX_DIFF_CHARS = 400_000;

export interface RepoSnapshot {
  head: string | null;
  /** Tracked changes against HEAD. */
  diff: string;
  stat: string;
  /** Files git has never seen; a diff against HEAD cannot show them. */
  untracked: string[];
}

async function git(cwd: string, args: string[], maxBuffer = 50 * 1024 * 1024): Promise<string | null> {
  try {
    const { stdout } = await exec('git', args, { cwd, timeout: 20_000, maxBuffer, windowsHide: true });
    return stdout;
  } catch {
    return null;
  }
}

/**
 * The working tree's state relative to HEAD. Read-only — this never stashes,
 * adds, or otherwise touches the index, because the repo belongs to the user
 * and an agent may be mid-edit in it.
 *
 * Null when `cwd` is not a git repository.
 */
export async function snapshotRepo(cwd: string): Promise<RepoSnapshot | null> {
  const inside = await git(cwd, ['rev-parse', '--is-inside-work-tree']);
  if (inside?.trim() !== 'true') return null;

  const [head, diff, stat, others] = await Promise.all([
    git(cwd, ['rev-parse', 'HEAD']),
    git(cwd, ['diff', 'HEAD', '--no-color']),
    git(cwd, ['diff', 'HEAD', '--stat', '--no-color']),
    git(cwd, ['ls-files', '--others', '--exclude-standard']),
  ]);

  return {
    // An unborn branch has no HEAD; treat it as a repo with nothing to diff against.
    head: head?.trim() || null,
    diff: diff ?? '',
    stat: stat?.trim() ?? '',
    untracked: (others ?? '').split('\n').map((l) => l.trim()).filter(Boolean),
  };
}

/**
 * The run's changes, from a snapshot before it and one after.
 *
 * The honest version of "what did the agent change" is the after-snapshot,
 * with a flag when the tree was already dirty: then the diff includes edits
 * the agent did not make, and saying so beats guessing which lines are whose.
 */
export function changesBetween(before: RepoSnapshot, after: RepoSnapshot): RunChanges {
  const truncated = after.diff.length > MAX_DIFF_CHARS;
  return {
    headBefore: before.head,
    dirtyBefore: before.diff.length > 0 || before.untracked.length > 0,
    stat: after.stat,
    diff: truncated ? after.diff.slice(0, MAX_DIFF_CHARS) : after.diff,
    untracked: after.untracked,
    truncated,
  };
}

/** True when the run left nothing behind — no diff, no new files. */
export const isEmptyChange = (c: RunChanges): boolean =>
  c.diff.trim() === '' && c.untracked.length === 0;
