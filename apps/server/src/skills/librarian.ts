import type {
  LibrarianReport,
  Project,
  ProposalKind,
  PublicSkillLink,
  Run,
  SkillEntry,
  SkillProposal,
} from '@cockpit/core';
import { loadAgents, loadPrompt } from '../agents/loader.ts';
import type { Store } from '../db.ts';
import { expandPath } from '../ingest/activity.ts';
import type { Executor } from '../runtime/executor.ts';
import { extractJsonBlock } from '../dream/contract.ts';
import { inventorySkills, readSkill, userSkillsDir } from './inventory.ts';
import { assertSafeName, stageProposals, type StagedProposal } from './staging.ts';
import { scanFriction } from './transcripts.ts';

/** Parses the librarian's JSON contract. Same posture as the dream contract. */
export type LibrarianParse =
  | { ok: true; report: LibrarianReport }
  | { ok: false; reason: string };

const KINDS: ProposalKind[] = ['new', 'rewrite', 'deprecate'];

function parseProposals(raw: unknown): SkillProposal[] {
  if (!Array.isArray(raw)) return [];

  return raw.flatMap((item): SkillProposal[] => {
    if (!item || typeof item !== 'object') return [];
    const p = item as Record<string, unknown>;

    const kind = p.kind as ProposalKind;
    if (!KINDS.includes(kind)) return [];
    if (typeof p.name !== 'string') return [];

    // A model-supplied name becomes a directory. Drop anything unsafe rather
    // than sanitising it into something the founder did not review.
    try {
      assertSafeName(p.name);
    } catch {
      return [];
    }

    const skillMd = typeof p.skillMd === 'string' && p.skillMd.trim() ? p.skillMd : undefined;
    if ((kind === 'new' || kind === 'rewrite') && !skillMd) return [];

    return [
      {
        kind,
        name: p.name,
        why: typeof p.why === 'string' ? p.why : '',
        skillMd: kind === 'deprecate' ? undefined : skillMd,
        targetPath: typeof p.targetPath === 'string' ? p.targetPath : undefined,
        diff: typeof p.diff === 'string' ? p.diff : undefined,
      },
    ];
  });
}

function parseLinks(raw: unknown): PublicSkillLink[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item): PublicSkillLink[] => {
    if (!item || typeof item !== 'object') return [];
    const l = item as Record<string, unknown>;
    if (typeof l.name !== 'string' || typeof l.url !== 'string') return [];
    if (!/^https?:\/\//.test(l.url)) return [];
    return [{ name: l.name, url: l.url, why: typeof l.why === 'string' ? l.why : '' }];
  });
}

export function parseLibrarianReport(text: string): LibrarianParse {
  const json = extractJsonBlock(text);
  if (!json) return { ok: false, reason: 'The run produced no JSON block.' };

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (err) {
    return {
      ok: false,
      reason: `The JSON block did not parse: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, reason: 'The JSON block was not an object.' };
  }

  const obj = parsed as Record<string, unknown>;

  // Every field here is optional on its own — a pass that proposes nothing is a
  // real outcome. But an object carrying none of them is not this contract at
  // all; it is some other object that happened to parse. Saying so is the whole
  // point of §8: a wrong block must fail loudly, not stage nothing and claim
  // success.
  if (!('summary' in obj) && !('proposals' in obj) && !('publicSkills' in obj)) {
    return {
      ok: false,
      reason: 'The JSON block was not a librarian report — no summary, proposals or publicSkills.',
    };
  }

  return {
    ok: true,
    report: {
      summary: typeof obj.summary === 'string' ? obj.summary : '',
      proposals: parseProposals(obj.proposals).slice(0, 5),
      publicSkills: parseLinks(obj.publicSkills),
    },
  };
}

function renderInventory(skills: SkillEntry[], bodies: Map<string, string>): string {
  if (skills.length === 0) return 'No skills are installed anywhere.';

  return skills
    .map((s) => {
      const body = bodies.get(s.path);
      const scope = s.scope === 'user' ? 'user-level' : `project: ${s.owner}`;
      return [
        `### ${s.name} (${scope})`,
        `Path: ${s.path}`,
        `Updated: ${s.updatedAt.slice(0, 10)} · ${s.bytes} bytes`,
        '',
        body ? '```markdown\n' + body.slice(0, 4000) + '\n```' : '(unreadable)',
      ].join('\n');
    })
    .join('\n\n');
}

export interface LibrarianDeps {
  repoRoot: string;
  store: Store;
  executor: Executor;
}

export type LibrarianOutcome =
  | { status: 'done'; runId: string; report: LibrarianReport; staged: StagedProposal[] }
  | { status: 'failed'; runId: string; reason: string };

export class Librarian {
  constructor(private readonly deps: LibrarianDeps) {}

  /**
   * Weekly pass: inventory, friction, recent dreams → proposals staged in
   * `skills-proposed/`. Nothing is installed; that needs a human (§9).
   */
  async run(
    projects: Project[],
    opts: { onRun?: (run: Run) => void } = {},
  ): Promise<LibrarianOutcome> {
    const { repoRoot, store, executor } = this.deps;

    const agents = await loadAgents(repoRoot);
    const def = agents.get('skill-librarian');
    if (!def) throw new Error('No agents/skill-librarian.yaml found.');

    const skills = await inventorySkills(projects);
    const bodies = new Map<string, string>();
    for (const skill of skills) {
      const body = await readSkill(skill.path);
      if (body) bodies.set(skill.path, body);
    }

    const friction = await scanFriction(7);
    const dreams = store
      .listReports()
      .filter((r) => Date.now() - new Date(r.createdAt).getTime() < 7 * 86_400_000)
      .slice(0, 10);

    const prompt = await loadPrompt(repoRoot, def, {
      repoRoot,
      inventory: renderInventory(skills, bodies),
      friction:
        friction.length === 0
          ? 'No repeated instructions found. The transcript scan may simply have nothing to work with.'
          : friction.map((f) => `- (${f.occurrences}×) ${f.text}`).join('\n'),
      dreams:
        dreams.length === 0
          ? 'No dream reports in the last 7 days.'
          : dreams
              .map((d) => `- ${d.report.project} (${d.report.health}): ${d.report.where_we_are}`)
              .join('\n'),
    });

    const run = executor.launch({
      agentName: def.name,
      projectId: null,
      repoPath: repoRoot,
      permissionProfile: def.permissionProfile,
      prompt,
      model: def.model,
      maxTurns: def.maxTurns,
    });

    // Same reason as the dream pipeline: the caller needs the run id now.
    opts.onRun?.(run);

    const finished = await executor.whenFinished(run.id);
    if (finished.status !== 'success') {
      return { status: 'failed', runId: run.id, reason: finished.error ?? 'the run did not succeed' };
    }

    const text = store.resultText(run.id);
    if (!text) return { status: 'failed', runId: run.id, reason: 'no result text' };

    const parsed = parseLibrarianReport(text);
    if (!parsed.ok) {
      store.finishRun(run.id, {
        status: 'error',
        durationMs: finished.durationMs,
        costUsd: finished.costUsd,
        numTurns: finished.numTurns,
        error: `Librarian contract not met: ${parsed.reason}`,
      });
      return { status: 'failed', runId: run.id, reason: parsed.reason };
    }

    const staged = await stageProposals(repoRoot, parsed.report.proposals);
    return { status: 'done', runId: run.id, report: parsed.report, staged };
  }
}

/** Skills directories the installer may overwrite, for rewrite proposals. */
export function allowedSkillRoots(projects: Project[]): string[] {
  const roots = [userSkillsDir()];
  for (const project of projects) {
    if (project.repoPath) roots.push(expandPath(project.repoPath) + '/.claude/skills');
  }
  return roots;
}
