import Fastify, { type FastifyInstance } from 'fastify';
import type { PermissionProfile } from '@cockpit/core';
import { Bus } from './bus.ts';
import type { Store } from './db.ts';
import type { Portfolio } from './portfolio.ts';
import { Executor } from './runtime/executor.ts';
import { specFor } from './runtime/profiles.ts';

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

export function buildApp(deps: { portfolio: PortfolioSource; store: Store }): App {
  const { portfolio, store } = deps;

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

  return { app, bus, executor };
}
