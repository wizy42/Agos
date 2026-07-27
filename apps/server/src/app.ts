import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import type { PermissionProfile } from '@cockpit/core';
import { loadAgents, parseAgentDef } from './agents/loader.ts';
import { Bus } from './bus.ts';
import type { Store } from './db.ts';
import type { Portfolio } from './portfolio.ts';
import { Executor } from './runtime/executor.ts';
import { specFor } from './runtime/profiles.ts';
import { inventorySkills } from './skills/inventory.ts';
import { allowedSkillRoots } from './skills/librarian.ts';
import { installProposal, listProposals, rejectProposal } from './skills/staging.ts';

/** Agent files live in `agents/<name>.yaml`; the name is validated on write. */
const AGENT_NAME = /^[a-z0-9][a-z0-9-]{0,63}$/;

function agentPath(repoRoot: string, name: string): string {
  if (!AGENT_NAME.test(name)) throw new Error(`Unsafe agent name ${JSON.stringify(name)}.`);
  return join(repoRoot, 'agents', `${name}.yaml`);
}

const readAgentYaml = (repoRoot: string, name: string): Promise<string> =>
  readFile(agentPath(repoRoot, name), 'utf8');

const writeAgentYaml = (repoRoot: string, name: string, yaml: string): Promise<void> =>
  writeFile(agentPath(repoRoot, name), yaml, 'utf8');

/** The portfolio surface the routes depend on — a seam for testing. */
export interface PortfolioSource {
  load(): Promise<Portfolio>;
}

export interface App {
  app: FastifyInstance;
  bus: Bus;
  executor: Executor;
}

const sameId = (a: string, b: string): boolean => a.replace(/-/g, '') === b.replace(/-/g, '');

export function buildApp(deps: {
  portfolio: PortfolioSource;
  store: Store;
  repoRoot: string;
}): App {
  const { portfolio, store, repoRoot } = deps;

  const app = Fastify({ logger: false });
  const bus = new Bus(app.server);
  const executor = new Executor(store, bus);

  app.get('/api/health', async () => ({ ok: true }));

  app.get('/api/portfolio', async (_req, reply) => {
    try {
      const data = await portfolio.load();
      return { ...data, spend7d: store.spendSince(7), activeRunIds: executor.activeRunIds };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      reply.code(502);
      return { error: 'notion_unavailable', message };
    }
  });

  app.get<{ Params: { id: string } }>('/api/projects/:id', async (req, reply) => {
    const { projects } = await portfolio.load();
    const project = projects.find((p) => sameId(p.id, req.params.id));
    if (!project) {
      reply.code(404);
      return { error: 'not_found' };
    }
    return { project, runs: store.listRuns({ projectId: project.id }) };
  });

  app.get('/api/runs', async () => ({ runs: store.listRuns({ limit: 100 }) }));

  app.get<{ Params: { id: string } }>('/api/runs/:id', async (req, reply) => {
    const run = store.getRun(req.params.id);
    if (!run) {
      reply.code(404);
      return { error: 'not_found' };
    }
    return { run, events: store.listEvents(run.id) };
  });

  app.post<{
    Body: {
      projectId?: string;
      permissionProfile?: PermissionProfile;
      prompt?: string;
      model?: string;
      maxTurns?: number;
    };
  }>('/api/runs', async (req, reply) => {
    const body = req.body ?? {};
    const prompt = body.prompt?.trim();
    const profile = body.permissionProfile ?? 'observer';

    if (!prompt) {
      reply.code(400);
      return { error: 'prompt_required' };
    }

    try {
      specFor(profile);
    } catch (err) {
      reply.code(400);
      return { error: 'bad_profile', message: err instanceof Error ? err.message : String(err) };
    }

    const { projects } = await portfolio.load();
    const project = projects.find((p) => sameId(p.id, body.projectId ?? ''));

    if (!project) {
      reply.code(400);
      return { error: 'unknown_project' };
    }
    if (!project.repoPath) {
      reply.code(400);
      return {
        error: 'no_repo_path',
        message: `${project.name} has no repo path. Set it in cockpit.config.ts or the registry.`,
      };
    }
    if (!project.activity?.repoFound) {
      reply.code(400);
      return {
        error: 'repo_not_found',
        message: `${project.repoPath} does not exist on this machine.`,
      };
    }

    const run = executor.launch({
      agentName: profile === 'builder' ? 'builder' : 'observer',
      projectId: project.id,
      repoPath: project.repoPath,
      permissionProfile: profile,
      prompt,
      model: body.model,
      maxTurns: body.maxTurns,
    });

    return { run };
  });

  app.post<{ Params: { id: string } }>('/api/runs/:id/cancel', async (req, reply) => {
    if (!executor.cancel(req.params.id)) {
      reply.code(404);
      return { error: 'not_running' };
    }
    return { ok: true };
  });

  /**
   * The CEO inbox: unreviewed dream reports, plus dreams that failed. A parse
   * failure has to be visible here — never silently dropped (§8).
   */
  app.get('/api/inbox', async () => {
    const { projects } = await portfolio.load();
    const names = new Map(projects.map((p) => [p.id, p.name]));

    return {
      reports: store.listReports({ unreviewedOnly: true }).map((r) => ({
        ...r,
        projectName: names.get(r.projectId) ?? r.report.project,
      })),
      failures: store.failedDreams().map((run) => ({
        run,
        projectName: run.projectId ? (names.get(run.projectId) ?? 'unknown') : 'unknown',
      })),
    };
  });

  app.post<{ Params: { id: string } }>('/api/inbox/:id/dismiss', async (req, reply) => {
    if (!store.markReviewed(req.params.id)) {
      reply.code(404);
      return { error: 'not_found' };
    }
    return { ok: true };
  });

  /**
   * Approve one proposed action → a pre-filled run on that project.
   * "Ask follow-up" posts here too, with `mode: 'follow-up'`.
   */
  app.post<{
    Params: { id: string };
    Body: { actionIndex?: number; mode?: 'approve' | 'follow-up'; question?: string };
  }>('/api/inbox/:id/approve', async (req, reply) => {
    const stored = store.listReports().find((r) => r.id === req.params.id);
    if (!stored) {
      reply.code(404);
      return { error: 'not_found' };
    }

    const { projects } = await portfolio.load();
    const project = projects.find((p) => sameId(p.id, stored.projectId));
    if (!project?.repoPath || !project.activity?.repoFound) {
      reply.code(400);
      return { error: 'repo_unavailable', message: 'That project has no usable repo path.' };
    }

    const mode = req.body?.mode ?? 'approve';
    let prompt: string;
    let profile: PermissionProfile;

    if (mode === 'follow-up') {
      const question = req.body?.question?.trim();
      if (!question) {
        reply.code(400);
        return { error: 'question_required' };
      }
      // Seed the observer with the report it is being asked about.
      prompt = [
        'You are following up on an overnight review of this project.',
        '',
        'The review said:',
        '```json',
        JSON.stringify(stored.report, null, 2),
        '```',
        '',
        'The founder asks:',
        question,
        '',
        'Answer from what the repository actually shows. Be concrete and brief.',
      ].join('\n');
      profile = 'observer';
    } else {
      const action = stored.report.proposed_next_actions[req.body?.actionIndex ?? 0];
      if (!action) {
        reply.code(400);
        return { error: 'unknown_action' };
      }
      prompt = action.prompt;
      profile = action.agent === 'observer' ? 'observer' : 'builder';
    }

    const run = executor.launch({
      agentName: profile,
      projectId: project.id,
      repoPath: project.repoPath,
      permissionProfile: profile,
      prompt,
      maxTurns: 25,
    });

    return { run };
  });

  /* ---------------------------- agents & skills ---------------------------- */

  app.get('/api/agents', async () => {
    const defs = await loadAgents(repoRoot);
    const files = await Promise.all(
      [...defs.values()].map(async (def) => ({
        def,
        yaml: await readAgentYaml(repoRoot, def.name),
      })),
    );
    return { agents: files, runs: store.listRuns({ limit: 100 }) };
  });

  /** Edit an agent YAML in place. Rejected unless it still parses (§10). */
  app.put<{ Params: { name: string }; Body: { yaml?: string } }>(
    '/api/agents/:name',
    async (req, reply) => {
      const yaml = req.body?.yaml;
      if (typeof yaml !== 'string') {
        reply.code(400);
        return { error: 'yaml_required' };
      }
      try {
        const def = parseAgentDef(yaml, `${req.params.name}.yaml`);
        if (def.name !== req.params.name) {
          reply.code(400);
          return {
            error: 'name_mismatch',
            message: `The definition names "${def.name}" but the file is ${req.params.name}.yaml.`,
          };
        }
        await writeAgentYaml(repoRoot, req.params.name, yaml);
        return { def };
      } catch (err) {
        reply.code(400);
        return { error: 'invalid', message: err instanceof Error ? err.message : String(err) };
      }
    },
  );

  app.get('/api/skills', async () => {
    const { projects } = await portfolio.load();
    return {
      installed: await inventorySkills(projects),
      proposals: await listProposals(repoRoot),
    };
  });

  /**
   * Install a staged proposal. This is the only path that writes a SKILL.md
   * into a real skills directory, and it exists solely behind a human click —
   * the librarian never installs anything (§9).
   */
  app.post<{ Params: { name: string } }>('/api/skills/proposals/:name/install', async (req, reply) => {
    try {
      const { projects } = await portfolio.load();
      const result = await installProposal(repoRoot, req.params.name, {
        allowedRoots: allowedSkillRoots(projects),
      });
      return result;
    } catch (err) {
      reply.code(400);
      return { error: 'install_failed', message: err instanceof Error ? err.message : String(err) };
    }
  });

  app.post<{ Params: { name: string } }>('/api/skills/proposals/:name/reject', async (req, reply) => {
    try {
      if (!(await rejectProposal(repoRoot, req.params.name))) {
        reply.code(404);
        return { error: 'not_found' };
      }
      return { ok: true };
    } catch (err) {
      reply.code(400);
      return { error: 'reject_failed', message: err instanceof Error ? err.message : String(err) };
    }
  });

  return { app, bus, executor };
}
