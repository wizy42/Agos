import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import type { Project } from '@cockpit/core';
import { buildApp } from './app.ts';
import { Store } from './db.ts';
import { sampleRegistry, StubPortfolio } from './portfolio.stub.ts';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

/** The id in a URL has its dashes stripped, the way the UI links it. */
const compact = (id: string) => id.replace(/-/g, '');

test('the stub serves the sample rows, with activity read from disk rather than made up', async () => {
  const { projects, fetchedAt } = await new StubPortfolio(repoRoot).load();

  assert.deepEqual(
    projects.map((p) => p.name),
    sampleRegistry(repoRoot).map((r) => r.name),
  );
  assert.ok(!Number.isNaN(Date.parse(fetchedAt)), fetchedAt);

  // Across tiers, so the portfolio renders more than one section.
  const tiers = new Set(projects.map((p) => p.tier));
  assert.ok(tiers.size >= 2, [...tiers].join(', '));

  const here = projects.find((p) => p.repoPath === repoRoot);
  assert.ok(here, 'one sample points at this checkout');
  assert.equal(here.activity?.repoFound, true);

  const missing = projects.find((p) => p.repoPath && p.repoPath !== repoRoot);
  assert.ok(missing, 'one sample names a clone that is not on this machine');
  assert.equal(missing.activity?.repoFound, false);

  const unlinked = projects.find((p) => p.repoPath === null);
  assert.ok(unlinked, 'one sample has no repo path yet');
  assert.equal(unlinked.activity, null);
});

test('in stub mode the portfolio renders and the Notion-backed routes answer 503', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cockpit-stub-'));
  // Exactly what index.ts builds under COCKPIT_STUB=1: no registry, no jobs.
  const { app } = buildApp({ portfolio: new StubPortfolio(repoRoot), store: new Store(dir), repoRoot });

  const portfolio = await app.inject({ method: 'GET', url: '/api/portfolio' });
  assert.equal(portfolio.statusCode, 200);
  const { projects } = portfolio.json<{ projects: Project[] }>();
  assert.deepEqual(
    projects.map((p) => p.name),
    sampleRegistry(repoRoot).map((r) => r.name),
  );

  const [first] = projects;
  assert.ok(first);
  const one = await app.inject({ method: 'GET', url: `/api/projects/${compact(first.id)}` });
  assert.equal(one.statusCode, 200);
  assert.equal(one.json<{ project: Project }>().project.name, first.name);

  // The wizard needs the registry; without Notion it says so, rather than
  // pretending to create a row.
  const candidates = await app.inject({ method: 'GET', url: '/api/hub/candidates' });
  assert.equal(candidates.statusCode, 503);
  assert.match(candidates.json<{ message: string }>().message, /without Notion/);

  const register = await app.inject({
    method: 'POST',
    url: '/api/registry',
    payload: { pageId: '0'.repeat(32), name: 'Nope', tier: 'IDEAS' },
  });
  assert.equal(register.statusCode, 503);

  // Neither loop is started in stub mode.
  for (const url of [`/api/projects/${compact(first.id)}/dream`, '/api/librarian']) {
    const res = await app.inject({ method: 'POST', url });
    assert.equal(res.statusCode, 503, url);
  }
});
