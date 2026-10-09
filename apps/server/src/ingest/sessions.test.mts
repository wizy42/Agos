import assert from 'node:assert/strict';
import { mkdir, mkdtemp, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { recentSessions, sessionDirFor } from './sessions.ts';

const line = (type: string, text: string, ts: string) =>
  JSON.stringify({ type, timestamp: ts, message: { role: type, content: [{ type: 'text', text }] } });

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'cockpit-sessions-'));
  const repo = '/home/wizy/code/launchpad';
  const dir = join(root, sessionDirFor(repo));
  await mkdir(dir, { recursive: true });

  await writeFile(
    join(dir, 'aaa.jsonl'),
    [
      line('user', '<command-name>/clear</command-name>', '2026-10-01T09:00:00Z'),
      line('user', 'Add a pricing page with three tiers and a Stripe checkout button.', '2026-10-01T09:01:00Z'),
      line('assistant', 'Sure.', '2026-10-01T09:02:00Z'),
      line('user', 'Now wire the webhook.', '2026-10-01T10:30:00Z'),
      'not json at all',
    ].join('\n'),
  );
  await writeFile(
    join(dir, 'bbb.jsonl'),
    [line('user', 'Fix the failing deploy on Vercel.', '2026-10-05T18:00:00Z')].join('\n'),
  );
  // An old session, outside the window.
  const old = join(dir, 'old.jsonl');
  await writeFile(old, line('user', 'Ancient history that should not appear.', '2026-01-01T00:00:00Z'));
  await utimes(old, new Date('2026-01-01'), new Date('2026-01-01'));

  return { root, repo };
}

test('summarises each recent session by its opening request, newest first', async () => {
  const { root, repo } = await fixture();
  const sessions = await recentSessions(repo, { projectsDir: root, days: 30, limit: 10 });

  assert.deepEqual(
    sessions.map((s) => s.opening),
    ['Fix the failing deploy on Vercel.', 'Add a pricing page with three tiers and a Stripe checkout button.'],
  );
  assert.equal(sessions[1]!.userTurns, 2);
  assert.equal(sessions[1]!.startedAt, '2026-10-01T09:01:00.000Z');
  assert.equal(sessions[1]!.lastAt, '2026-10-01T10:30:00.000Z');
});

test('sessions older than the window are left out', async () => {
  const { root, repo } = await fixture();
  const sessions = await recentSessions(repo, { projectsDir: root, days: 30, limit: 10 });
  assert.equal(sessions.some((s) => s.opening.includes('Ancient')), false);
});

test('a repo with no session directory yields an empty list, never a throw', async () => {
  const root = await mkdtemp(join(tmpdir(), 'cockpit-sessions-'));
  assert.deepEqual(await recentSessions('/nowhere/at/all', { projectsDir: root }), []);
});

test('the session directory name is the repo path with slashes replaced', () => {
  assert.equal(sessionDirFor('/home/wizy/code/launchpad'), '-home-wizy-code-launchpad');
});
