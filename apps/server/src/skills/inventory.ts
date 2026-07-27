import { readFile, readdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import type { Project, SkillEntry } from '@cockpit/core';
import { expandPath } from '../ingest/activity.ts';

/**
 * Inventories installed skills: the user's own (`~/.claude/skills/*`) and each
 * tracked repo's (`<repo>/.claude/skills/*`). Read-only.
 */

export const userSkillsDir = (): string => join(homedir(), '.claude', 'skills');

/** First `# heading` or `name:` frontmatter line, else the directory name. */
function titleOf(markdown: string, fallback: string): string {
  const frontmatter = /^---\n([\s\S]*?)\n---/.exec(markdown);
  if (frontmatter?.[1]) {
    const name = /^name:\s*(.+)$/m.exec(frontmatter[1]);
    if (name?.[1]) return name[1].trim();
  }
  const heading = /^#\s+(.+)$/m.exec(markdown);
  return heading?.[1]?.trim() ?? fallback;
}

/** `description:` from frontmatter, else the first non-heading paragraph. */
function descriptionOf(markdown: string): string {
  const frontmatter = /^---\n([\s\S]*?)\n---/.exec(markdown);
  if (frontmatter?.[1]) {
    const desc = /^description:\s*(.+)$/m.exec(frontmatter[1]);
    if (desc?.[1]) return desc[1].trim().slice(0, 300);
  }
  const body = markdown.replace(/^---\n[\s\S]*?\n---\n/, '');
  for (const line of body.split('\n')) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) return trimmed.slice(0, 300);
  }
  return '';
}

async function scanDir(dir: string, scope: SkillEntry['scope'], owner: string | null): Promise<SkillEntry[]> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return [];
  }

  const skills: SkillEntry[] = [];

  for (const entry of entries) {
    const skillPath = join(dir, entry, 'SKILL.md');
    try {
      const info = await stat(skillPath);
      const markdown = await readFile(skillPath, 'utf8');
      skills.push({
        name: entry,
        title: titleOf(markdown, entry),
        description: descriptionOf(markdown),
        path: skillPath,
        scope,
        owner,
        bytes: info.size,
        updatedAt: new Date(info.mtimeMs).toISOString(),
      });
    } catch {
      // Not a skill directory — skip.
    }
  }

  return skills.sort((a, b) => a.name.localeCompare(b.name));
}

export async function inventorySkills(projects: Project[]): Promise<SkillEntry[]> {
  const all = await scanDir(userSkillsDir(), 'user', null);

  for (const project of projects) {
    if (!project.repoPath || !project.activity?.repoFound) continue;
    const dir = resolve(expandPath(project.repoPath), '.claude', 'skills');
    all.push(...(await scanDir(dir, 'project', project.name)));
  }

  return all;
}

/** Full text of a skill, for the librarian to rewrite against. */
export async function readSkill(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8');
  } catch {
    return null;
  }
}
