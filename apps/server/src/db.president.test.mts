import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import type { PresidentReport } from '@cockpit/core';
import { Store } from './db.ts';

const report: PresidentReport = {
  where_we_are: 'x',
  dimensions: [],
  priorities: [],
  questions_for_ceo: [],
  health: 'green',
};

async function store() {
  return new Store(await mkdtemp(join(tmpdir(), 'cockpit-db-')));
}

function run(s: Store, id: string, agentName: string) {
  s.createRun({
    id,
    agentName,
    projectId: null,
    cwd: '/',
    permissionProfile: 'observer',
    prompt: 'p',
    startedAt: new Date().toISOString(),
  });
}

test('portfolio reports are listed newest first and can be marked reviewed', async () => {
  const s = await store();
  run(s, 'r1', 'president');
  run(s, 'r2', 'president');
  s.addPortfolioReport({ id: 'a', runId: 'r1', createdAt: '2026-10-05T04:00:00Z', health: 'green', json: report });
  s.addPortfolioReport({ id: 'b', runId: 'r2', createdAt: '2026-10-12T04:00:00Z', health: 'red', json: report });

  assert.deepEqual(s.listPortfolioReports().map((r) => r.id), ['b', 'a']);
  assert.equal(s.listPortfolioReports()[0]!.report.where_we_are, 'x');

  assert.equal(s.markPortfolioReviewed('b'), true);
  assert.deepEqual(s.listPortfolioReports({ unreviewedOnly: true }).map((r) => r.id), ['a']);
  assert.equal(s.markPortfolioReviewed('nope'), false);
});

test('failed runs are filtered by agent name', async () => {
  const s = await store();
  run(s, 'd', 'dream-reviewer');
  run(s, 'p', 'president');
  run(s, 'ok', 'president');
  s.finishRun('d', { status: 'error', error: 'bad' });
  s.finishRun('p', { status: 'error', error: 'bad' });
  s.finishRun('ok', { status: 'success' });

  assert.deepEqual(s.failedRuns('president').map((r) => r.id), ['p']);
  assert.deepEqual(s.failedDreams().map((r) => r.id), ['d']);
});
