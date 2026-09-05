import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { findCloneByRemote, githubUrlIn, normalizeRemote } from './repos.ts';

test('every way of writing a remote normalises to the same identity', () => {
  const forms = [
    'https://github.com/wizy42/autobot33',
    'https://github.com/wizy42/autobot33.git',
    'https://github.com/wizy42/autobot33/',
    'git@github.com:wizy42/autobot33.git',
    'git@github.com:wizy42/autobot33',
    'ssh://git@github.com/wizy42/autobot33.git',
    'HTTPS://GITHUB.COM/Wizy42/AutoBot33',
  ];
  for (const f of forms) {
    assert.equal(normalizeRemote(f), 'github.com/wizy42/autobot33', f);
  }
});

test('garbage remotes are null, not a crash', () => {
  for (const bad of ['', '   ', 'not a url', 'https://', 'https://github.com/']) {
    assert.equal(normalizeRemote(bad), null, JSON.stringify(bad));
  }
});

test('the first GitHub URL is pulled out of page text, punctuation stripped', () => {
  const text = [
    '| GitHub | https://github.com/wizy42/autobot33. |',
    '| Live | https://example.com |',
    'see also https://github.com/wizy42/other',
  ].join('\n');
  assert.equal(githubUrlIn(text), 'https://github.com/wizy42/autobot33');
  assert.equal(githubUrlIn('nothing here'), null);
});

async function clone(root: string, name: string, origin: string): Promise<string> {
  const dir = join(root, name);
  await mkdir(dir, { recursive: true });
  execFileSync('git', ['init', '-q'], { cwd: dir });
  execFileSync('git', ['remote', 'add', 'origin', origin], { cwd: dir });
  return dir;
}

test('finds a clone by remote when its directory name is unrelated', async () => {
  const root = await mkdtemp(join(tmpdir(), 'cockpit-repos-'));
  await clone(root, 'unrelated-name', 'git@github.com:wizy42/autobot33.git');
  await clone(root, 'decoy', 'https://github.com/wizy42/something-else.git');

  const found = await findCloneByRemote('https://github.com/wizy42/autobot33', [root]);
  assert.equal(found, join(root, 'unrelated-name'));
});

test('finds a clone nested under a workspace directory', async () => {
  const root = await mkdtemp(join(tmpdir(), 'cockpit-repos-'));
  await clone(join(root, 'code', 'clients'), 'lp', 'https://github.com/wizy42/Launchpad');

  const found = await findCloneByRemote('https://github.com/wizy42/launchpad', [root]);
  assert.equal(found, join(root, 'code', 'clients', 'lp'));
});

test('returns null when no clone matches', async () => {
  const root = await mkdtemp(join(tmpdir(), 'cockpit-repos-'));
  await clone(root, 'x', 'https://github.com/wizy42/other');
  assert.equal(await findCloneByRemote('https://github.com/wizy42/missing', [root]), null);
});

test('does not descend into node_modules or past maxDepth', async () => {
  const root = await mkdtemp(join(tmpdir(), 'cockpit-repos-'));
  await clone(join(root, 'node_modules'), 'hidden', 'https://github.com/wizy42/target');
  await clone(join(root, 'a', 'b', 'c', 'd', 'e'), 'deep', 'https://github.com/wizy42/target');
  await writeFile(join(root, 'file.txt'), 'not a dir');

  assert.equal(await findCloneByRemote('https://github.com/wizy42/target', [root], 3), null);
});
