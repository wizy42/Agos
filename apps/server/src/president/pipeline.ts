import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { promisify } from 'node:util';
import type { Client } from '@notionhq/client';
import type { AgentDef, Project, Run } from '@cockpit/core';
import { loadAgents, loadPrompt } from '../agents/loader.ts';
import type { Store } from '../db.ts';
import { matches } from '../dream/pipeline.ts';
import { expandPath } from '../ingest/activity.ts';
import { recentSessions } from '../ingest/sessions.ts';
import { appendPresidentReport, resolvePortfolioLog } from '../notion/portfoliolog.ts';
import { readProjectPage } from '../notion/projectPage.ts';
import { normalizeNotionId } from '../notion/registry.ts';
import type { Executor } from '../runtime/executor.ts';
import { renderProjectBrief } from './brief.ts';
import { parsePresidentReport } from './contract.ts';

const exec = promisify(execFile);

export type PresidentOutcome =
  | { status: 'done'; runId: string; health: string; logPageId: string }
  | { status: 'failed'; runId: string; reason: string };

export interface PresidentDeps {
  repoRoot: string;
  store: Store;
  executor: Executor;
  notion: Client;
  hubPageId: string;
}

/** Days of commits and sessions the brief looks back over. */
const WINDOW_DAYS = 14;

async function gitLog(repoPath: string): Promise<string> {
  try {
    const { stdout } = await exec(
      'git',
      ['log', `--since=${WINDOW_DAYS} days ago`, '-15', '--format=%h %cs %s'],
      { cwd: expandPath(repoPath), timeout: 10_000 },
    );
    return stdout.trim();
  } catch {
    return '';
  }
}

/**
 * The President: one weekly pass over the whole portfolio instead of one
 * project a night. Reads the same things a dream reads, for every project at
 * once, plus the dreams themselves and the founder's recent sessions, and
 * answers the questions a dream cannot — what the portfolio is missing on
 * legal, marketing, traction, tooling and assets, and what comes first.
 *
 * Same shape as the dream pipeline: run the agent, parse the contract or fail
 * loudly, write the durable copy to Notion, keep a copy for the inbox.
 */
export class President {
  private agents: Map<string, AgentDef> | null = null;

  constructor(private readonly deps: PresidentDeps) {}

  private async agentDef(): Promise<AgentDef> {
    this.agents ??= await loadAgents(this.deps.repoRoot);
    const def = this.agents.get('president');
    if (!def) throw new Error('No agents/president.yaml found.');
    return def;
  }

  /** Everything the server knows about one project, as a section of the brief. */
  private async briefFor(project: Project): Promise<string> {
    const { notion, store } = this.deps;

    const pageId = project.projectPageUrl ? normalizeNotionId(project.projectPageUrl) : null;
    const page = pageId
      ? await readProjectPage(notion, pageId).catch(() => ({ text: null, sections: [] }))
      : { text: null, sections: [] };

    const dream = store.listReports({ projectId: project.id })[0];
    const repo = project.repoPath && project.activity?.repoFound ? project.repoPath : null;

    return renderProjectBrief({
      project,
      page,
      lastDream: dream ? { createdAt: dream.createdAt, report: dream.report } : null,
      gitLog: repo ? await gitLog(repo) : '',
      sessions: repo ? await recentSessions(expandPath(repo), { days: WINDOW_DAYS }) : [],
    });
  }

  async run(
    projects: Project[],
    opts: { focus?: string; onRun?: (run: Run) => void } = {},
  ): Promise<PresidentOutcome> {
    const { repoRoot, store, executor, notion, hubPageId } = this.deps;
    const def = await this.agentDef();

    // Archived projects are context, not work: they get a line, not a section.
    const live = projects.filter((p) => p.tier !== 'ARCHIVED');
    const archived = projects.filter((p) => p.tier === 'ARCHIVED');

    const sections: string[] = [];
    for (const project of live) sections.push(await this.briefFor(project));
    if (archived.length) {
      sections.push(`## Archived\n\n${archived.map((p) => `- ${p.name}`).join('\n')}`);
    }

    const focus = opts.focus ? live.find((p) => matches(p, opts.focus!)) : undefined;
    const previous = store.listPortfolioReports()[0];

    const prompt = await loadPrompt(repoRoot, def, {
      repoRoot,
      today: new Date().toISOString().slice(0, 10),
      projectCount: String(live.length),
      portfolio: sections.join('\n\n'),
      focus: focus
        ? `The founder asked you to focus this pass on **${focus.name}**. Keep the whole ` +
          'portfolio in view, but weight your dimensions and priorities toward what that ' +
          'project needs to reach a paying customer.'
        : 'No focus project this pass: weigh the whole portfolio evenly.',
      lastReport: previous
        ? `${previous.createdAt.slice(0, 10)}:\n${JSON.stringify(previous.report, null, 2)}`
        : 'No previous report — this is the first President pass.',
    });

    const run = executor.launch({
      agentName: def.name,
      projectId: focus?.id ?? null,
      repoPath: repoRoot,
      permissionProfile: def.permissionProfile,
      prompt,
      model: def.model,
      maxTurns: def.maxTurns,
    });
    opts.onRun?.(run);

    const finished = await executor.whenFinished(run.id);
    if (finished.status !== 'success') {
      return { status: 'failed', runId: run.id, reason: finished.error ?? 'the run did not succeed' };
    }

    const text = store.resultText(run.id);
    if (!text) {
      store.finishRun(run.id, { status: 'error', error: 'no result text' });
      return { status: 'failed', runId: run.id, reason: 'no result text' };
    }

    const parsed = parsePresidentReport(text);
    if (!parsed.ok) {
      store.finishRun(run.id, {
        status: 'error',
        durationMs: finished.durationMs,
        costUsd: finished.costUsd,
        numTurns: finished.numTurns,
        error: `President contract not met: ${parsed.reason}`,
      });
      return { status: 'failed', runId: run.id, reason: parsed.reason };
    }

    const when = new Date();
    const logPageId = await resolvePortfolioLog(notion, hubPageId);
    await appendPresidentReport(notion, logPageId, parsed.report, when);

    store.addPortfolioReport({
      id: randomUUID(),
      runId: run.id,
      createdAt: when.toISOString(),
      health: parsed.report.health,
      json: parsed.report,
    });

    return { status: 'done', runId: run.id, health: parsed.report.health, logPageId };
  }
}
