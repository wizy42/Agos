import { readFile, readdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { extractUserText } from '../skills/transcripts.ts';

/**
 * What the founder has been asking Claude Code to do on a project lately —
 * one line per session, for the President's brief.
 *
 * Same posture as the friction scan (§11): the JSONL layout under
 * `~/.claude/projects/` is internal and version-unstable, so everything here
 * degrades to an empty list rather than throwing, and nothing downstream may
 * treat it as load-bearing. Sessions run on claude.ai/code never reach this
 * disk at all; the brief says so.
 */

export interface SessionSummary {
  file: string;
  startedAt: string | null;
  lastAt: string | null;
  /** The first real instruction in the session, trimmed. */
  opening: string;
  userTurns: number;
}

/** Claude Code encodes a cwd as a directory name by replacing every `/` with `-`. */
export function sessionDirFor(repoPath: string): string {
  return repoPath.replace(/\//g, '-');
}

const OPENING_MAX = 240;

function timestampOf(line: string): string | null {
  try {
    const ts = (JSON.parse(line) as { timestamp?: unknown }).timestamp;
    return typeof ts === 'string' ? new Date(ts).toISOString() : null;
  } catch {
    return null;
  }
}

/** Slash commands, pasted XML and one-word replies are not instructions. */
function isInstruction(text: string): boolean {
  const t = text.trim();
  return t.length >= 12 && !t.startsWith('/') && !t.startsWith('<');
}

async function summarise(path: string): Promise<SessionSummary | null> {
  const raw = await readFile(path, 'utf8');
  let opening = '';
  let startedAt: string | null = null;
  let lastAt: string | null = null;
  let userTurns = 0;

  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    const text = extractUserText(line);
    if (!text || !isInstruction(text)) continue;
    userTurns++;
    const at = timestampOf(line);
    if (!opening) {
      opening = text.trim().replace(/\s+/g, ' ').slice(0, OPENING_MAX);
      startedAt = at;
    }
    if (at) lastAt = at;
  }

  return opening ? { file: path, startedAt, lastAt, opening, userTurns } : null;
}

export async function recentSessions(
  repoPath: string,
  opts: { projectsDir?: string; days?: number; limit?: number } = {},
): Promise<SessionSummary[]> {
  const projectsDir = opts.projectsDir ?? join(homedir(), '.claude', 'projects');
  const days = opts.days ?? 14;
  const limit = opts.limit ?? 8;
  const cutoff = Date.now() - days * 86_400_000;
  const dir = join(projectsDir, sessionDirFor(repoPath));

  let files: string[];
  try {
    files = await readdir(dir);
  } catch {
    return [];
  }

  const candidates: { path: string; mtime: number }[] = [];
  for (const f of files) {
    if (!f.endsWith('.jsonl')) continue;
    try {
      const info = await stat(join(dir, f));
      if (info.mtimeMs < cutoff || info.size > 12_000_000) continue;
      candidates.push({ path: join(dir, f), mtime: info.mtimeMs });
    } catch {
      // Unreadable or mid-write — best effort only.
    }
  }

  const out: SessionSummary[] = [];
  for (const c of candidates) {
    try {
      const s = await summarise(c.path);
      if (s) out.push(s);
    } catch {
      // Same: skip, never throw.
    }
  }

  const key = (s: SessionSummary) => s.lastAt ?? s.startedAt ?? '';
  return out.sort((a, b) => key(b).localeCompare(key(a))).slice(0, limit);
}
