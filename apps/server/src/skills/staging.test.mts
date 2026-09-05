import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  assertSafeName,
  installProposal,
  listProposals,
  rejectProposal,
  stageProposals,
} from './staging.ts';
import { parseLibrarianReport } from './librarian.ts';

const tmp = () => mkdtemp(join(tmpdir(), 'cockpit-staging-'));

test('rejects skill names that could escape the staging directory', () => {
  const unsafe = [
    '../escape',
    '../../etc/cron.d/evil',
    '/absolute',
    'has/slash',
    'has space',
    'Has-Capitals',
    '.hidden',
    '',
    'a'.repeat(65),
  ];
  for (const name of unsafe) {
    assert.throws(() => assertSafeName(name), `should have rejected ${JSON.stringify(name)}`);
  }
});

test('accepts ordinary skill names', () => {
  for (const name of ['commit-style', 'notion-sync', 'a', 'x1-2-3']) {
    assert.equal(assertSafeName(name), name);
  }
});

test('staging writes a draft and its rationale, and nothing else', async () => {
  const root = await tmp();
  const staged = await stageProposals(root, [
    { kind: 'new', name: 'commit-style', why: 'Repeated 4x', skillMd: '# Commit style\n\nUse imperative mood.' },
  ]);

  assert.equal(staged.length, 1);
  const dir = join(root, 'skills-proposed', 'commit-style');
  assert.deepEqual((await readdir(dir)).sort(), ['SKILL.md', 'proposal.json']);
  assert.match(await readFile(join(dir, 'SKILL.md'), 'utf8'), /imperative mood/);
});

test('a deprecation stages no SKILL.md and cannot be installed', async () => {
  const root = await tmp();
  await stageProposals(root, [
    { kind: 'deprecate', name: 'old-thing', why: 'Superseded', targetPath: '/tmp/x/SKILL.md' },
  ]);

  assert.deepEqual(await readdir(join(root, 'skills-proposed', 'old-thing')), ['proposal.json']);
  await assert.rejects(() => installProposal(root, 'old-thing'), /nothing to install/i);
});

test('staging a traversal name throws rather than writing', async () => {
  const root = await tmp();
  await assert.rejects(
    () => stageProposals(root, [{ kind: 'new', name: '../../evil', why: 'x', skillMd: 'x' }]),
    /Unsafe skill name/,
  );
});

test('a rewrite may not overwrite a file outside every known skills directory', async () => {
  const root = await tmp();
  await stageProposals(root, [
    {
      kind: 'rewrite',
      name: 'sneaky',
      why: 'x',
      targetPath: '/etc/cron.d/payload',
      skillMd: 'malicious',
    },
  ]);

  await assert.rejects(
    () => installProposal(root, 'sneaky', { allowedRoots: [] }),
    /outside every known skills directory/,
  );
});

test('a rewrite inside an allowed root installs over the original', async () => {
  const root = await tmp();
  const skillsRoot = join(root, 'repo', '.claude', 'skills');
  const target = join(skillsRoot, 'existing', 'SKILL.md');
  await mkdir(join(skillsRoot, 'existing'), { recursive: true });
  await writeFile(target, 'old body', 'utf8');

  await stageProposals(root, [
    { kind: 'rewrite', name: 'existing', why: 'stale', targetPath: target, skillMd: 'new body' },
  ]);

  const result = await installProposal(root, 'existing', { allowedRoots: [skillsRoot] });
  assert.equal(result.replaced, true);
  assert.equal(await readFile(target, 'utf8'), 'new body');
});

test('reject removes the staged proposal', async () => {
  const root = await tmp();
  await stageProposals(root, [{ kind: 'new', name: 'doomed', why: 'x', skillMd: 'y' }]);
  assert.equal((await listProposals(root)).length, 1);
  assert.equal(await rejectProposal(root, 'doomed'), true);
  assert.equal((await listProposals(root)).length, 0);
  assert.equal(await rejectProposal(root, 'doomed'), false);
});

test('installing an unknown proposal fails', async () => {
  const root = await tmp();
  await assert.rejects(() => installProposal(root, 'nope'), /No staged proposal/);
});

/* --------------------------- librarian contract --------------------------- */

test('parses a librarian report and drops unsafe or incomplete proposals', () => {
  const text =
    '```json\n' +
    JSON.stringify({
      summary: 'Two gaps.',
      proposals: [
        { kind: 'new', name: 'good-skill', why: 'w', skillMd: '# x' },
        { kind: 'new', name: '../escape', why: 'w', skillMd: '# x' },
        { kind: 'new', name: 'no-body', why: 'w' },
        { kind: 'bogus', name: 'wrong-kind', why: 'w', skillMd: '# x' },
        { kind: 'deprecate', name: 'gone', why: 'w', targetPath: '/a/SKILL.md' },
      ],
      publicSkills: [
        { name: 'ok', url: 'https://aitmpl.com', why: 'w' },
        { name: 'bad-scheme', url: 'javascript:alert(1)', why: 'w' },
      ],
    }) +
    '\n```';

  const res = parseLibrarianReport(text);
  assert.ok(res.ok);
  assert.deepEqual(res.report.proposals.map((p) => p.name), ['good-skill', 'gone']);
  assert.deepEqual(res.report.publicSkills.map((p) => p.name), ['ok']);
});

test('a deprecation never carries a body through the parser', () => {
  const text = JSON.stringify({
    summary: '',
    proposals: [{ kind: 'deprecate', name: 'gone', why: 'w', skillMd: 'should be dropped' }],
  });
  const res = parseLibrarianReport(text);
  assert.ok(res.ok);
  assert.equal(res.report.proposals[0]?.skillMd, undefined);
});

test('a librarian run with no JSON block is a failure', () => {
  const res = parseLibrarianReport('I found nothing worth changing.');
  assert.equal(res.ok, false);
});

test('proposals are capped at five', () => {
  const text = JSON.stringify({
    summary: '',
    proposals: Array.from({ length: 9 }, (_, i) => ({
      kind: 'new',
      name: `skill-${i}`,
      why: 'w',
      skillMd: '# x',
    })),
  });
  const res = parseLibrarianReport(text);
  assert.equal(res.ok && res.report.proposals.length, 5);
});

test('an object that is not a librarian report fails instead of staging nothing', () => {
  // A trailing schema example can parse and end last; treating it as an empty
  // report would mark the run done and quietly stage nothing (§8).
  const parsed = parseLibrarianReport('```json\n{"where_we_are": "x", "health": "green"}\n```');
  assert.equal(parsed.ok, false);
  assert.match(parsed.ok === false ? parsed.reason : '', /not a librarian report/);
});

test('a report proposing nothing is still a valid report', () => {
  const parsed = parseLibrarianReport('```json\n{"summary": "All good.", "proposals": []}\n```');
  assert.equal(parsed.ok, true);
  assert.equal(parsed.ok && parsed.report.proposals.length, 0);
});

test('a malformed report does not silently become the example shown before it', () => {
  // The librarian marking a run done and staging nothing, because it parsed the
  // example instead of the real report, is the silent drop §8 forbids.
  const F = '```';
  const parsed = parseLibrarianReport(
    `${F}json\n{"summary":"EXAMPLE","proposals":[]}\n${F}\n` +
      `Here is my report:\n${F}json\n{"summary":"REAL","proposals":[}\n${F}`,
  );

  assert.equal(parsed.ok, false, 'should fail loudly rather than stage the example');
  assert.match(parsed.ok === false ? parsed.reason : '', /did not parse/);
});
