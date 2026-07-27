import { readFile, readdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * Best-effort scan of recent Claude Code session transcripts, looking for
 * instructions the founder types over and over — friction is a skill candidate.
 *
 * The JSONL format is internal and version-unstable (§11), so this is written
 * to degrade to an empty list rather than throw. Nothing downstream may treat
 * it as load-bearing.
 */

export interface FrictionSample {
  /** Normalized instruction text. */
  text: string;
  /** How many separate sessions contained something close to it. */
  occurrences: number;
}

const PROJECTS_DIR = () => join(homedir(), '.claude', 'projects');

/** Strips paths, hashes, and numbers so near-identical instructions collapse. */
function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`]*`/g, ' ')
    .replace(/(?:\/[\w.-]+){2,}/g, ' PATH ')
    .replace(/\b[0-9a-f]{7,}\b/g, ' HASH ')
    .replace(/\d+/g, 'N')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractUserText(line: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;

  const entry = parsed as Record<string, any>;
  if (entry.type !== 'user') return null;

  const content = entry.message?.content;
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return null;

  const text = content
    .filter((b: any) => b?.type === 'text' && typeof b.text === 'string')
    .map((b: any) => b.text)
    .join('\n');

  return text || null;
}

/**
 * Returns instructions that recur across sessions, most repeated first.
 * `days` bounds how far back session files are read.
 */
export async function scanFriction(days = 7, limit = 25): Promise<FrictionSample[]> {
  const cutoff = Date.now() - days * 86_400_000;
  const counts = new Map<string, { text: string; sessions: Set<string> }>();

  let projectDirs: string[];
  try {
    projectDirs = await readdir(PROJECTS_DIR());
  } catch {
    return [];
  }

  for (const projectDir of projectDirs) {
    const dir = join(PROJECTS_DIR(), projectDir);
    let files: string[];
    try {
      files = await readdir(dir);
    } catch {
      continue;
    }

    for (const file of files.filter((f) => f.endsWith('.jsonl'))) {
      const full = join(dir, file);
      try {
        const info = await stat(full);
        if (info.mtimeMs < cutoff) continue;
        // Skip transcripts large enough to be worth not holding in memory.
        if (info.size > 12_000_000) continue;

        const raw = await readFile(full, 'utf8');
        for (const line of raw.split('\n')) {
          if (!line.trim()) continue;
          const text = extractUserText(line);
          if (!text) continue;

          // Slash commands, pastes, and one-word replies are not instructions.
          const trimmed = text.trim();
          if (trimmed.startsWith('/') || trimmed.length < 25 || trimmed.length > 600) continue;
          if (trimmed.startsWith('<')) continue;

          const key = normalize(trimmed);
          if (key.length < 20) continue;

          const existing = counts.get(key);
          if (existing) existing.sessions.add(file);
          else counts.set(key, { text: trimmed, sessions: new Set([file]) });
        }
      } catch {
        // Unreadable or mid-write file — best effort only.
      }
    }
  }

  return [...counts.values()]
    .map((v) => ({ text: v.text, occurrences: v.sessions.size }))
    .filter((v) => v.occurrences > 1)
    .sort((a, b) => b.occurrences - a.occurrences)
    .slice(0, limit);
}
