import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { changesBetween, isEmptyChange, snapshotRepo } from './snapshot.ts';

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', args, { cwd, stdio: 'pipe' }).toString();

/** A real repo with one committed file, as a builder run would find it. */
async function repo(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'cockpit-snap-'));
  git(dir, 'init', '-q');
  git(dir, 'config', 'user.email', 't@t');
  git(dir, 'config', 'user.name', 't');
  await writeFile(join(dir, 'a.txt'), 'one\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-qm', 'init');
  return dir;
}

test('a clean tree snapshots as nothing to report', async () => {
  const dir = await repo();
  const snap = await snapshotRepo(dir);
  assert.ok(snap);
  assert.ok(snap.head);
  assert.equal(snap.diff, '');
  assert.deepEqual(snap.untracked, []);
});

test('a non-repo directory yields null rather than throwing', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cockpit-notgit-'));
  assert.equal(await snapshotRepo(dir), null);
});

test('edits and new files after a clean start are the run\'s own', async () => {
  const dir = await repo();
  const before = (await snapshotRepo(dir))!;

  await writeFile(join(dir, 'a.txt'), 'one\ntwo\n');
  await writeFile(join(dir, 'new.txt'), 'hello\n');
  const after = (await snapshotRepo(dir))!;

  const changes = changesBetween(before, after);
  assert.equal(changes.dirtyBefore, false);
  assert.match(changes.diff, /\+two/);
  assert.match(changes.stat, /a\.txt/);
  assert.deepEqual(changes.untracked, ['new.txt']);
  assert.equal(changes.truncated, false);
  assert.equal(isEmptyChange(changes), false);
});

test('a tree that was dirty before the run is flagged, never guessed at', async () => {
  const dir = await repo();
  await writeFile(join(dir, 'a.txt'), 'one\npre-existing\n');
  const before = (await snapshotRepo(dir))!;

  await writeFile(join(dir, 'b.txt'), 'agent\n');
  const after = (await snapshotRepo(dir))!;

  const changes = changesBetween(before, after);
  assert.equal(changes.dirtyBefore, true);
  // The diff honestly includes the pre-existing edit; the flag is the caveat.
  assert.match(changes.diff, /pre-existing/);
  assert.deepEqual(changes.untracked, ['b.txt']);
});

test('a run that touched nothing reports an empty change', async () => {
  const dir = await repo();
  const before = (await snapshotRepo(dir))!;
  const after = (await snapshotRepo(dir))!;
  assert.equal(isEmptyChange(changesBetween(before, after)), true);
});

test('an oversized diff is capped and marked truncated', async () => {
  const dir = await repo();
  const before = (await snapshotRepo(dir))!;
  await writeFile(join(dir, 'a.txt'), 'x'.repeat(500_000) + '\n');
  const after = (await snapshotRepo(dir))!;

  const changes = changesBetween(before, after);
  assert.equal(changes.truncated, true);
  assert.ok(changes.diff.length <= 400_000);
});

test('snapshotting never touches the index or working tree', async () => {
  const dir = await repo();
  await writeFile(join(dir, 'a.txt'), 'edited\n');
  await writeFile(join(dir, 'u.txt'), 'untracked\n');
  const statusBefore = git(dir, 'status', '--porcelain');

  await snapshotRepo(dir);

  assert.equal(git(dir, 'status', '--porcelain'), statusBefore);
});
