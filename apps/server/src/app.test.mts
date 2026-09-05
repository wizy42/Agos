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

async function harness(jobs: Jobs | null) {
  const dir = await mkdtemp(join(tmpdir(), 'cockpit-app-'));
  const { app } = buildApp({ portfolio, store: new Store(dir), repoRoot, jobs: () => jobs });
  return app;
}

/** The id in a URL has its dashes stripped, the way the UI links it. */
const compact = project.id.replace(/-/g, '');

test('dreaming a project answers as soon as the run exists, not when it ends', async () => {
  let finish: (() => void) | undefined;
  const app = await harness({
    dream: (_p, onRun) => {
      onRun(aRun('run-1'));
      // The job stays in flight well past the response — that is the point.
      return new Promise((res) => {
        finish = () => res({ status: 'skipped', project: 'Pilot', reason: 'done later' });
      });
    },
    librarian: async () => ({ status: 'failed', runId: 'x', reason: 'unused' }),
  });

  const res = await app.inject({ method: 'POST', url: `/api/projects/${compact}/dream` });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json<{ run: Run }>().run.id, 'run-1');

  finish?.();
});

test('a dream that never starts reports why instead of a run', async () => {
  const app = await harness({
    dream: async () => ({ status: 'skipped', project: 'Pilot', reason: 'repo not on this machine' }),
    librarian: async () => ({ status: 'failed', runId: 'x', reason: 'unused' }),
  });

  const res = await app.inject({ method: 'POST', url: `/api/projects/${compact}/dream` });
  assert.equal(res.statusCode, 409);
  assert.match(res.json<{ message: string }>().message, /not on this machine/);
});

test('a job that throws before launching is a 500 with the reason', async () => {
  const app = await harness({
    dream: () => Promise.reject(new Error('no agents/dream-reviewer.yaml found')),
    librarian: async () => ({ status: 'failed', runId: 'x', reason: 'unused' }),
  });

  const res = await app.inject({ method: 'POST', url: `/api/projects/${compact}/dream` });
  assert.equal(res.statusCode, 500);
  assert.match(res.json<{ message: string }>().message, /dream-reviewer/);
});

test('dreaming an unknown project is a 404', async () => {
  const app = await harness({
    dream: async () => ({ status: 'skipped', project: 'x', reason: 'x' }),
    librarian: async () => ({ status: 'failed', runId: 'x', reason: 'unused' }),
  });

  const res = await app.inject({ method: 'POST', url: '/api/projects/deadbeef/dream' });
  assert.equal(res.statusCode, 404);
});

test('the loops answer 503 when the server was built without them', async () => {
  const app = await harness(null);

  for (const url of [`/api/projects/${compact}/dream`, '/api/librarian']) {
    const res = await app.inject({ method: 'POST', url });
    assert.equal(res.statusCode, 503, url);
  }
});

test('the librarian can be started by hand and returns its run', async () => {
  const app = await harness({
    dream: async () => ({ status: 'skipped', project: 'x', reason: 'x' }),
    librarian: (_projects, onRun) => {
      onRun({ ...aRun('run-lib'), agentName: 'skill-librarian', projectId: null });
      return new Promise(() => {});
    },
  });

  const res = await app.inject({ method: 'POST', url: '/api/librarian' });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json<{ run: Run }>().run.id, 'run-lib');
});
