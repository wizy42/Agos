import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseDreamReport, reportToMarkdown } from './contract.ts';

const valid = {
  project: 'LaunchPad',
  where_we_are: 'Spec is locked, no shippable surface yet.',
  what_moved: ['ADR-002 merged'],
  risks: ['No paying user contacted'],
  proposed_next_actions: [
    { title: 'Ship the audit page', why: 'First revenue path', agent: 'builder', prompt: 'Do it.' },
  ],
  questions_for_ceo: ['Pricing?'],
  health: 'orange',
};

test('parses a fenced json block with prose around it', () => {
  const text = `Here is my review.\n\n\`\`\`json\n${JSON.stringify(valid)}\n\`\`\``;
  const res = parseDreamReport(text, 'fallback');
  assert.equal(res.ok, true);
  assert.equal(res.ok && res.report.health, 'orange');
  assert.equal(res.ok && res.report.proposed_next_actions[0]?.agent, 'builder');
});

test('takes the last json block when the agent shows an example first', () => {
  const decoy = { ...valid, health: 'green', where_we_are: 'decoy' };
  const text = `Example:\n\`\`\`json\n${JSON.stringify(decoy)}\n\`\`\`\nActual:\n\`\`\`json\n${JSON.stringify(valid)}\n\`\`\``;
  const res = parseDreamReport(text, 'fallback');
  assert.equal(res.ok && res.report.where_we_are, valid.where_we_are);
});

test('parses a bare object with no fence', () => {
  const res = parseDreamReport(`Review done.\n${JSON.stringify(valid)}`, 'fallback');
  assert.equal(res.ok, true);
});

test('handles braces inside strings when scanning unfenced json', () => {
  const tricky = { ...valid, where_we_are: 'Uses ${braces} and "quotes" and }} oddities' };
  const res = parseDreamReport(JSON.stringify(tricky), 'fallback');
  assert.equal(res.ok && res.report.where_we_are, tricky.where_we_are);
});

test('a fenced example inside a string does not truncate the block', () => {
  // The failure that motivated this: a librarian rewrite embedded a SKILL.md
  // draft whose body showed its own ```json block, and non-greedy fence
  // matching ended the report there — mid-string, 8k characters early.
  const quoting = {
    ...valid,
    where_we_are: 'The hook doc shows:\n```json\n{"session_id": "abc"}\n```\nand carries on.',
  };
  const text = `Review:\n\`\`\`json\n${JSON.stringify(quoting)}\n\`\`\``;
  const res = parseDreamReport(text, 'fallback');
  assert.equal(res.ok, true);
  assert.equal(res.ok && res.report.where_we_are, quoting.where_we_are);
});

test('several fences inside one report all survive', () => {
  const many = {
    ...valid,
    risks: ['```sh\nnpm run dev\n```', '```json\n{"a": 1}\n```'],
    questions_for_ceo: ['Keep ```ts blocks``` in prompts?'],
  };
  const res = parseDreamReport(`\`\`\`json\n${JSON.stringify(many)}\n\`\`\``, 'fallback');
  assert.equal(res.ok, true);
  assert.deepEqual(res.ok && res.report.risks, many.risks);
});

test('a lone quote in the prose does not swallow the report', () => {
  // An unpaired `"` before the block used to invert the scanner's string state
  // for everything after it, so the report was skipped and some small nested
  // object was returned instead — a silent wrong answer, the worst outcome.
  const text = `Checked the "hooks section.\n\n\`\`\`json\n${JSON.stringify(valid)}\n\`\`\``;
  const res = parseDreamReport(text, 'fallback');
  assert.equal(res.ok, true);
  assert.equal(res.ok && res.report.where_we_are, valid.where_we_are);
});

test('a windows path in the prose does not swallow the report', () => {
  // Even quote count, but the backslash before the closing quote escapes it.
  const text = `The skill lives at "C:\\skills\\" on Windows.\n\`\`\`json\n${JSON.stringify(valid)}\n\`\`\``;
  const res = parseDreamReport(text, 'fallback');
  assert.equal(res.ok, true);
  assert.equal(res.ok && res.report.where_we_are, valid.where_we_are);
});

test('an unclosed brace in the prose does not truncate the block', () => {
  // Depth never returns to zero after this, so a single forward scan finds
  // nothing; the rescan from the fence opener is what recovers the report.
  const text = `- Set {sessionId in the hook\n\n\`\`\`json\n${JSON.stringify(valid)}\n\`\`\``;
  const res = parseDreamReport(text, 'fallback');
  assert.equal(res.ok, true);
  assert.equal(res.ok && res.report.where_we_are, valid.where_we_are);
});

test('an inner fence does not let a nested object outrank the report', () => {
  const nested = {
    ...valid,
    risks: ['See ```json\n{"name": "example", "url": "https://x", "why": "decoy"}\n```'],
  };
  const text = `Notes "unbalanced\n\`\`\`json\n${JSON.stringify(nested)}\n\`\`\``;
  const res = parseDreamReport(text, 'fallback');
  assert.equal(res.ok, true);
  assert.deepEqual(res.ok && res.report.risks, nested.risks);
});

test('trailing prose with braces does not win over the real block', () => {
  const text = `\`\`\`json\n${JSON.stringify(valid)}\n\`\`\`\n\nNote: set {retries} to 3.`;
  const res = parseDreamReport(text, 'fallback');
  assert.equal(res.ok, true);
  assert.equal(res.ok && res.report.where_we_are, valid.where_we_are);
});

test('a missing json block is a failure, not a silent drop', () => {
  const res = parseDreamReport('I could not complete the review.', 'fallback');
  assert.equal(res.ok, false);
  assert.match(res.ok === false ? res.reason : '', /no JSON block/i);
});

test('malformed json is reported with a reason', () => {
  const res = parseDreamReport('```json\n{"where_we_are": "x",,}\n```', 'fallback');
  assert.equal(res.ok, false);
  assert.match(res.ok === false ? res.reason : '', /did not parse/i);
});

test('an invalid health value is rejected', () => {
  const res = parseDreamReport(JSON.stringify({ ...valid, health: 'yellow' }), 'fallback');
  assert.equal(res.ok, false);
  assert.match(res.ok === false ? res.reason : '', /health/);
});

test('a missing where_we_are is rejected', () => {
  const { where_we_are, ...rest } = valid;
  void where_we_are;
  const res = parseDreamReport(JSON.stringify(rest), 'fallback');
  assert.equal(res.ok, false);
});

test('proposed actions are capped at three and bad entries dropped', () => {
  const many = {
    ...valid,
    proposed_next_actions: [
      ...Array.from({ length: 5 }, (_, i) => ({ title: `t${i}`, why: 'w', agent: 'builder', prompt: 'p' })),
      { title: 'no prompt' },
    ],
  };
  const res = parseDreamReport(JSON.stringify(many), 'fallback');
  assert.equal(res.ok && res.report.proposed_next_actions.length, 3);
});

test('falls back to the known project name when the agent omits it', () => {
  const { project, ...rest } = valid;
  void project;
  const res = parseDreamReport(JSON.stringify(rest), 'LaunchPad');
  assert.equal(res.ok && res.report.project, 'LaunchPad');
});

test('markdown carries every section', () => {
  const res = parseDreamReport(JSON.stringify(valid), 'x');
  assert.ok(res.ok);
  const md = reportToMarkdown(res.report, new Date('2026-07-27T02:00:00Z'));
  assert.match(md, /### 2026-07-27 — orange/);
  assert.match(md, /ADR-002 merged/);
  assert.match(md, /Ship the audit page/);
  assert.match(md, /Pricing\?/);
});

test('empty sections render as (none) rather than vanishing', () => {
  const bare = { ...valid, what_moved: [], risks: [], proposed_next_actions: [], questions_for_ceo: [] };
  const res = parseDreamReport(JSON.stringify(bare), 'x');
  assert.ok(res.ok);
  const md = reportToMarkdown(res.report, new Date('2026-07-27T02:00:00Z'));
  assert.equal(md.match(/\(none\)/g)?.length, 4);
});
