import { copyFile, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import type { SkillProposal } from '@cockpit/core';
import { userSkillsDir } from './inventory.ts';

/**
 * The staging area for librarian output.
 *
 * The hard rule from §9 lives here: **nothing is ever auto-installed**. A
 * SKILL.md is instructions your agents will obey, so an unreviewed one is a
 * prompt-injection vector. The librarian writes only into `skills-proposed/`;
 * copying into a real skills directory happens exclusively through `install()`,
 * which a human triggers.
 */

/** Skill names come from a model, so they are never trusted as path segments. */
const SAFE_NAME = /^[a-z0-9][a-z0-9-]{0,63}$/;

export function assertSafeName(name: string): string {
  if (!SAFE_NAME.test(name)) {
    throw new Error(
      `Unsafe skill name ${JSON.stringify(name)}. Expected lower-case letters, digits and hyphens.`,
    );
  }
  return name;
}

/** Rejects any path that escapes `root`, symlinks and `..` included. */
function assertInside(root: string, candidate: string): string {
  const resolved = resolve(candidate);
  const rel = relative(resolve(root), resolved);
  if (rel.startsWith('..') || resolve(rel) === rel) {
    throw new Error(`Refusing to write outside ${root}: ${candidate}`);
  }
  return resolved;
}

export const stagingDir = (repoRoot: string): string => join(repoRoot, 'skills-proposed');

export interface StagedProposal extends SkillProposal {
  stagedAt: string;
}

/** Writes drafts into `skills-proposed/<name>/`, alongside the rationale. */
export async function stageProposals(
  repoRoot: string,
  proposals: SkillProposal[],
): Promise<StagedProposal[]> {
  const root = stagingDir(repoRoot);
  const staged: StagedProposal[] = [];

  for (const proposal of proposals) {
    assertSafeName(proposal.name);
    const dir = assertInside(root, join(root, proposal.name));
    await mkdir(dir, { recursive: true });

    const meta = {
      ...proposal,
      stagedAt: new Date().toISOString(),
      stagedPath: proposal.skillMd ? join(dir, 'SKILL.md') : undefined,
    };

    if (proposal.skillMd) {
      await writeFile(meta.stagedPath!, proposal.skillMd, 'utf8');
    }
    await writeFile(join(dir, 'proposal.json'), JSON.stringify(meta, null, 2), 'utf8');

    staged.push(meta);
  }

  return staged;
}

export async function listProposals(repoRoot: string): Promise<StagedProposal[]> {
  const root = stagingDir(repoRoot);
  let names: string[];
  try {
    names = await readdir(root);
  } catch {
    return [];
  }

  const out: StagedProposal[] = [];
  for (const name of names) {
    try {
      const raw = await readFile(join(root, name, 'proposal.json'), 'utf8');
      out.push(JSON.parse(raw) as StagedProposal);
    } catch {
      // Not a staged proposal.
    }
  }

  return out.sort((a, b) => b.stagedAt.localeCompare(a.stagedAt));
}

export async function rejectProposal(repoRoot: string, name: string): Promise<boolean> {
  assertSafeName(name);
  const dir = assertInside(stagingDir(repoRoot), join(stagingDir(repoRoot), name));
  try {
    await stat(dir);
  } catch {
    return false;
  }
  await rm(dir, { recursive: true, force: true });
  return true;
}

export interface InstallResult {
  installedTo: string;
  replaced: boolean;
}

/**
 * Copies a staged draft into a real skills directory. Only ever called from the
 * explicit install action — never from the librarian run itself.
 *
 * A rewrite installs over the file it was written against; a new skill installs
 * under `~/.claude/skills/<name>/SKILL.md`.
 */
export async function installProposal(
  repoRoot: string,
  name: string,
  opts: { allowedRoots: string[] } = { allowedRoots: [] },
): Promise<InstallResult> {
  assertSafeName(name);

  const proposals = await listProposals(repoRoot);
  const proposal = proposals.find((p) => p.name === name);
  if (!proposal) throw new Error(`No staged proposal named ${name}.`);
  if (proposal.kind === 'deprecate') {
    throw new Error('A deprecation proposal has nothing to install; remove the skill yourself.');
  }
  if (!proposal.stagedPath) throw new Error(`Proposal ${name} has no staged SKILL.md.`);

  let destination: string;
  let replaced = false;

  if (proposal.kind === 'rewrite' && proposal.targetPath) {
    // Confine rewrites to directories we actually inventoried.
    const roots = [userSkillsDir(), ...opts.allowedRoots];
    const target = resolve(proposal.targetPath);
    const ok = roots.some((root) => {
      const rel = relative(resolve(root), target);
      return rel !== '' && !rel.startsWith('..') && resolve(rel) !== rel;
    });
    if (!ok) {
      throw new Error(
        `Refusing to overwrite ${proposal.targetPath} — it is outside every known skills directory.`,
      );
    }
    destination = target;
    replaced = true;
  } else {
    destination = join(userSkillsDir(), name, 'SKILL.md');
    try {
      await stat(destination);
      replaced = true;
    } catch {
      replaced = false;
    }
  }

  await mkdir(dirname(destination), { recursive: true });
  await copyFile(proposal.stagedPath, destination);

  return { installedTo: destination, replaced };
}
