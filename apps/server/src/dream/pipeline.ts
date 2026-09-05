import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { promisify } from 'node:util';
import type { Client } from '@notionhq/client';
import type { AgentDef, Project, Run } from '@cockpit/core';
import { interpolate, loadAgents, loadPrompt } from '../agents/loader.ts';
import type { Store } from '../db.ts';
import { expandPath } from '../ingest/activity.ts';
import { appendDream, resolveDreamLog, updateRegistryRow } from '../notion/dreamlog.ts';
import { readProjectPage } from '../notion/projectPage.ts';
import { normalizeNotionId } from '../notion/registry.ts';
import type { RegistrySchema } from '../notion/registry.ts';
import type { Executor } from '../runtime/executor.ts';
import { parseDreamReport } from './contract.ts';

const exec = promisify(execFile);

export type DreamOutcome =
  | { status: 'skipped'; project: string; reason: string }
  | { status: 'failed'; project: string; runId: string; reason: string }
  | { status: 'done'; project: string; runId: string; health: string; dreamLogPageId: string };

/** Commits and diffstat since the last dream, for the prompt's `gitDelta`. */
async function gitDelta(repoPath: string, since: string | null): Promise<string> {
  const cwd = expandPath(repoPath);
  const run = async (args: string[]): Promise<string> => {
    try {
      const { stdout } = await exec('git', args, { cwd, timeout: 10_000 });
      return stdout.trim();
    } catch {
      return '';
    }
  };

  const range = since ? [`--since=${since}`] : ['-20'];
  const log = await run(['log', ...range, '--format=%h %cs %s']);
  const stat = await run(['diff', '--stat', 'HEAD~20..HEAD']);
  const status = await run(['status', '--porcelain']);

  const parts: string[] = [];
  parts.push(
    since
      ? `Commits since the last review (${since}):`
      : 'No previous review. Last 20 commits:',
  );
  parts.push(log || '(no commits in this window)');

  if (stat) parts.push('', 'Recent diffstat:', stat);
  if (status) parts.push('', 'Uncommitted changes:', status);

  return parts.join('\n');
}

/** Nothing changed since the last dream → skip, unless forced (§8). */
function hasMoved(project: Project, lastDream: string | null): boolean {
  if (!lastDream) return true;
  const since = new Date(lastDream).getTime();
  const a = project.activity;
  const stamps = [a?.lastCommitAt, a?.lastSessionAt]
    .filter((v): v is string => Boolean(v))
    .map((v) => new Date(v).getTime());
  return stamps.some((t) => t > since);
}

export interface DreamDeps {
  repoRoot: string;
  store: Store;
  executor: Executor;
  notion: Client;
  schema: RegistrySchema;
}

export class DreamPipeline {
  private agents: Map<string, AgentDef> | null = null;

  constructor(private readonly deps: DreamDeps) {}

  private async agentDef(): Promise<AgentDef> {
    this.agents ??= await loadAgents(this.deps.repoRoot);
    const def = this.agents.get('dream-reviewer');
    if (!def) {
      throw new Error('No agents/dream-reviewer.yaml found.');
    }
    return def;
  }

  /**
   * One project, end to end: run the agent, parse its contract, write the Dream
   * Log and registry row, store the report for the inbox.
   */
  async dream(
    project: Project,
    opts: { force?: boolean; onRun?: (run: Run) => void } = {},
  ): Promise<DreamOutcome> {
    const { store, executor, notion, schema, repoRoot } = this.deps;

    if (!project.repoPath) {
      return { status: 'skipped', project: project.name, reason: 'no repo path configured' };
    }
    if (!project.activity?.repoFound) {
      return {
        status: 'skipped',
        project: project.name,
        reason: `${project.repoPath} not found on this machine`,
      };
    }
    if (!opts.force && !hasMoved(project, project.lastDream)) {
      return {
        status: 'skipped',
        project: project.name,
        reason: 'nothing changed since the last dream',
      };
    }

    const def = await this.agentDef();
    const previous = store.listReports({ projectId: project.id })[0];

    // The project page is where maturity, MRR, the primary blocker and the
    // locked decisions live. A dream without it asks the founder questions his
    // own page already answers.
    const pageId = project.projectPageUrl ? normalizeNotionId(project.projectPageUrl) : null;
    const page = pageId
      ? await readProjectPage(notion, pageId).catch(() => ({ text: null, sections: [] }))
      : { text: null, sections: [] };

    const prompt = await loadPrompt(repoRoot, def, {
      projectName: project.name,
      project: [
        `Name: ${project.name}`,
        `Tier: ${project.tier ?? 'untiered'}`,
        `Repo: ${project.repoPath}`,
        `Branch: ${project.activity?.branch ?? 'unknown'}`,
        `Current registry status: ${project.status ?? 'none set'}`,
        `Notion page: ${project.projectPageUrl ?? 'none'}`,
        '',
        page.text
          ? `--- From the Notion project page${
              page.sections.length ? ` (${page.sections.join(', ')})` : ''
            } ---\n${page.text}`
          : '(The Notion project page could not be read. Judge from the repository alone,' +
            ' and say so rather than guessing at strategy.)',
      ].join('\n'),
      gitDelta: await gitDelta(project.repoPath, project.lastDream),
      lastDreamReport: previous
        ? JSON.stringify(previous.report, null, 2)
        : 'No previous review — this is the first dream for this project.',
    });

    const run = executor.launch({
      agentName: def.name,
      projectId: project.id,
      repoPath: interpolate(def.cwd, { 'project.repoPath': project.repoPath }),
      permissionProfile: def.permissionProfile,
      prompt,
      model: def.model,
      maxTurns: def.maxTurns,
    });

    // Lets a caller answer "started" before the run finishes — the UI needs the
    // id now so it can follow the stream, not in three minutes.
    opts.onRun?.(run);

    const finished = await executor.whenFinished(run.id);

    if (finished.status !== 'success') {
      return {
        status: 'failed',
        project: project.name,
        runId: run.id,
        reason: finished.error ?? 'the dream run did not succeed',
      };
    }

    const text = store.resultText(run.id);
    if (!text) {
      store.finishRun(run.id, { status: 'error', error: 'no result text' });
      return { status: 'failed', project: project.name, runId: run.id, reason: 'no result text' };
    }

    const parsed = parseDreamReport(text, project.name);
    if (!parsed.ok) {
      // A parse failure is a failed run, surfaced in the inbox — never dropped.
      store.finishRun(run.id, {
        status: 'error',
        durationMs: finished.durationMs,
        costUsd: finished.costUsd,
        numTurns: finished.numTurns,
        error: `Dream contract not met: ${parsed.reason}`,
      });
      return { status: 'failed', project: project.name, runId: run.id, reason: parsed.reason };
    }

    const when = new Date();
    const dreamLogPageId = await resolveDreamLog(notion, project);
    await appendDream(notion, dreamLogPageId, parsed.report, when);
    await updateRegistryRow(notion, schema, project.id, parsed.report, when);

    store.addReport({
      id: randomUUID(),
      runId: run.id,
      projectId: project.id,
      createdAt: when.toISOString(),
      health: parsed.report.health,
      json: parsed.report,
    });

    return {
      status: 'done',
      project: project.name,
      runId: run.id,
      health: parsed.report.health,
      dreamLogPageId,
    };
  }

  /**
   * The nightly sweep: opted-in projects only, sequential, capped per night.
   * Sequential is deliberate — it respects rate limits and the monthly Agent
   * SDK credit, and keeps one dream's failure from cascading (§8, §11).
   */
  async dreamAll(
    projects: Project[],
    opts: { force?: boolean; max: number; only?: string },
  ): Promise<DreamOutcome[]> {
    const candidates = projects
      .filter((p) => (opts.only ? matches(p, opts.only) : p.dream))
      .slice(0, opts.max);

    const outcomes: DreamOutcome[] = [];
    for (const project of candidates) {
      try {
        outcomes.push(await this.dream(project, opts));
      } catch (err) {
        outcomes.push({
          status: 'failed',
          project: project.name,
          runId: '',
          reason: err instanceof Error ? err.message : String(err),
        });
      }
    }
    return outcomes;
  }
}

/** Matches `--project` against name or registry row id, case-insensitively. */
export function matches(project: Project, needle: string): boolean {
  const n = needle.trim().toLowerCase();
  return (
    project.name.toLowerCase() === n ||
    project.name.toLowerCase().includes(n) ||
    project.id.replace(/-/g, '') === n.replace(/-/g, '')
  );
}
