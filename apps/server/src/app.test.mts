import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { test } from 'node:test';
import type { Project, Run } from '@cockpit/core';
import { buildApp, type Jobs } from './app.ts';
import { Store } from './db.ts';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

const project: Project = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Pilot',
  projectPageUrl: null,
  registryRowUrl: 'https://notion.so/row',
  tier: 'SHIP NOW',
  status: 'green',
  repoPath: repoRoot,
  dream: true,
  lastDream: null,
  nextStep: null,
  activity: {
    repoFound: true,
    branch: 'main',
    lastCommitAt: null,
    lastCommitSubject: null,
    dirty: false,
    lastSessionAt: null,
  },
};

const portfolio = { load: async () => ({ projects: [project], fetchedAt: 'now' }) };

const aRun = (id: string): Run => ({
  id,
  agentName: 'dream-reviewer',
  projectId: project.id,
  cwd: repoRoot,
  permissionProfile: 'observer',
  prompt: 'review',
  status: 'running',
  startedAt: 'now',
  endedAt: null,
  durationMs: null,
  costUsd: null,
  numTurns: null,
  sessionId: null,
  error: null,
});

/** Every loop has to be present on `Jobs`; tests name only the one they exercise. */
function jobs(over: Partial<Jobs>): Jobs {
  return {
    dream: async () => ({ status: 'skipped', project: 'x', reason: 'unused' }),
    librarian: async () => ({ status: 'failed', runId: 'x', reason: 'unused' }),
    president: async () => ({ status: 'failed', runId: 'x', reason: 'unused' }),
    ...over,
  };
}

async function harness(jobs: Jobs | null, store?: Store) {
  const dir = await mkdtemp(join(tmpdir(), 'cockpit-app-'));
  const { app } = buildApp({ portfolio, store: store ?? new Store(dir), repoRoot, jobs: () => jobs });
  return app;
}

/** The id in a URL has its dashes stripped, the way the UI links it. */
const compact = project.id.replace(/-/g, '');

test('dreaming a project answers as soon as the run exists, not when it ends', async () => {
  let finish: (() => void) | undefined;
  const app = await harness(
    jobs({
      dream: (_p, onRun) => {
        onRun(aRun('run-1'));
        // The job stays in flight well past the response — that is the point.
        return new Promise((res) => {
          finish = () => res({ status: 'skipped', project: 'Pilot', reason: 'done later' });
        });
      },
    }),
  );

  const res = await app.inject({ method: 'POST', url: `/api/projects/${compact}/dream` });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json<{ run: Run }>().run.id, 'run-1');

  finish?.();
});

test('a dream that never starts reports why instead of a run', async () => {
  const app = await harness(
    jobs({
      dream: async () => ({ status: 'skipped', project: 'Pilot', reason: 'repo not on this machine' }),
    }),
  );

  const res = await app.inject({ method: 'POST', url: `/api/projects/${compact}/dream` });
  assert.equal(res.statusCode, 409);
  assert.match(res.json<{ message: string }>().message, /not on this machine/);
});

test('a job that throws before launching is a 500 with the reason', async () => {
  const app = await harness(
    jobs({ dream: () => Promise.reject(new Error('no agents/dream-reviewer.yaml found')) }),
  );

  const res = await app.inject({ method: 'POST', url: `/api/projects/${compact}/dream` });
  assert.equal(res.statusCode, 500);
  assert.match(res.json<{ message: string }>().message, /dream-reviewer/);
});

test('dreaming an unknown project is a 404', async () => {
  const app = await harness(jobs({}));

  const res = await app.inject({ method: 'POST', url: '/api/projects/deadbeef/dream' });
  assert.equal(res.statusCode, 404);
});

test('the loops answer 503 when the server was built without them', async () => {
  const app = await harness(null);

  for (const url of [`/api/projects/${compact}/dream`, '/api/librarian', '/api/president']) {
    const res = await app.inject({ method: 'POST', url });
    assert.equal(res.statusCode, 503, url);
  }
});

test('the librarian can be started by hand and returns its run', async () => {
  const app = await harness(
    jobs({
      librarian: (_projects, onRun) => {
        onRun({ ...aRun('run-lib'), agentName: 'skill-librarian', projectId: null });
        return new Promise(() => {});
      },
    }),
  );

  const res = await app.inject({ method: 'POST', url: '/api/librarian' });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json<{ run: Run }>().run.id, 'run-lib');
});

/* ------------------------------- president ------------------------------- */

import type { PresidentReport } from '@cockpit/core';

const presidentReport: PresidentReport = {
  where_we_are: 'One project close to revenue.',
  dimensions: [],
  priorities: [
    { project: 'Pilot', title: 'Price it', why: 'w', agent: 'founder', prompt: 'Email three users.' },
    { project: 'Pilot', title: 'Add /pricing', why: 'w', agent: 'builder', prompt: 'Add a pricing page.' },
    { project: 'Ghost', title: 'Unknown project', why: 'w', agent: 'observer', prompt: 'Look.' },
  ],
  questions_for_ceo: [],
  health: 'orange',
};

async function storeWithPresidentReport() {
  const store = new Store(await mkdtemp(join(tmpdir(), 'cockpit-app-')));
  store.createRun({
    id: 'run-pres',
    agentName: 'president',
    projectId: null,
    cwd: repoRoot,
    permissionProfile: 'observer',
    prompt: 'p',
    startedAt: 'now',
  });
  store.finishRun('run-pres', { status: 'success' });
  store.addPortfolioReport({
    id: 'rep-1',
    runId: 'run-pres',
    createdAt: '2026-10-12T04:00:00Z',
    health: 'orange',
    json: presidentReport,
  });
  return store;
}

test('the president can be started by hand, optionally focused on one project', async () => {
  let seenFocus: string | undefined;
  const app = await harness(
    jobs({
      president: (_projects, opts, onRun) => {
        seenFocus = opts.focus;
        onRun({ ...aRun('run-pres'), agentName: 'president', projectId: null });
        return new Promise(() => {});
      },
    }),
  );

  const res = await app.inject({ method: 'POST', url: '/api/president', payload: { focus: 'Pilot' } });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json<{ run: Run }>().run.id, 'run-pres');
  assert.equal(seenFocus, 'Pilot');
});

test('the president screen lists reports newest first with the projects they can act on', async () => {
  const app = await harness(jobs({}), await storeWithPresidentReport());
  const res = await app.inject({ method: 'GET', url: '/api/president' });
  assert.equal(res.statusCode, 200);
  const body = res.json<{ reports: { id: string }[]; projects: { name: string }[] }>();
  assert.deepEqual(body.reports.map((r) => r.id), ['rep-1']);
  assert.deepEqual(body.projects.map((p) => p.name), ['Pilot']);
});

test('approving an agent priority launches a run on the named project', async () => {
  const app = await harness(jobs({}), await storeWithPresidentReport());
  const res = await app.inject({
    method: 'POST',
    url: '/api/president/rep-1/approve',
    payload: { index: 1 },
  });
  assert.equal(res.statusCode, 200);
  const { run } = res.json<{ run: Run }>();
  assert.equal(run.projectId, project.id);
  assert.equal(run.permissionProfile, 'builder');
  assert.equal(run.prompt, 'Add a pricing page.');
});

test('a founder priority is not something an agent can run', async () => {
  const app = await harness(jobs({}), await storeWithPresidentReport());
  const res = await app.inject({
    method: 'POST',
    url: '/api/president/rep-1/approve',
    payload: { index: 0 },
  });
  assert.equal(res.statusCode, 400);
  assert.equal(res.json<{ error: string }>().error, 'founder_action');
});

test('a priority naming an unknown project cannot be approved', async () => {
  const app = await harness(jobs({}), await storeWithPresidentReport());
  const res = await app.inject({
    method: 'POST',
    url: '/api/president/rep-1/approve',
    payload: { index: 2 },
  });
  assert.equal(res.statusCode, 400);
  assert.equal(res.json<{ error: string }>().error, 'unknown_project');
});

test('dismissing a president report hides it from the inbox', async () => {
  const store = await storeWithPresidentReport();
  const app = await harness(jobs({}), store);

  const before = await app.inject({ method: 'GET', url: '/api/inbox' });
  assert.equal(before.json<{ president: { id: string } | null }>().president?.id, 'rep-1');

  const res = await app.inject({ method: 'POST', url: '/api/president/rep-1/dismiss' });
  assert.equal(res.statusCode, 200);

  const after = await app.inject({ method: 'GET', url: '/api/inbox' });
  assert.equal(after.json<{ president: unknown }>().president, null);
});
