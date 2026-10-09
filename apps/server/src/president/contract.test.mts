import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parsePresidentReport, presidentToMarkdown } from './contract.ts';

const GOOD = `Some reasoning first.

\`\`\`json
{
  "where_we_are": "Fourteen projects, one close to revenue.",
  "dimensions": [
    { "dimension": "product", "where_we_are": "LaunchPad is shippable.", "missing": ["a pricing page"] },
    { "dimension": "legal", "where_we_are": "No CGV anywhere.", "missing": ["CGV for 11bis"] },
    { "dimension": "bogus", "where_we_are": "ignored", "missing": [] }
  ],
  "priorities": [
    { "project": "LaunchPad", "title": "Put a price on it", "why": "closest to a customer", "agent": "founder", "prompt": "Email the three beta users with a price." },
    { "project": "11bis", "title": "Write the CGV", "why": "blocks the first invoice", "agent": "builder", "prompt": "Add a /cgv page." },
    { "project": "Foag", "title": "Weird agent", "why": "x", "agent": "wizard", "prompt": "y" }
  ],
  "questions_for_ceo": ["Kill Vibrand?"],
  "health": "orange"
}
\`\`\``;

test('parses a well-formed president report, dropping unknown dimensions', () => {
  const parsed = parsePresidentReport(GOOD);
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(parsed.report.where_we_are, 'Fourteen projects, one close to revenue.');
  assert.deepEqual(
    parsed.report.dimensions.map((d) => d.dimension),
    ['product', 'legal'],
  );
  assert.deepEqual(parsed.report.dimensions[1]!.missing, ['CGV for 11bis']);
  assert.equal(parsed.report.health, 'orange');
  assert.deepEqual(parsed.report.questions_for_ceo, ['Kill Vibrand?']);
});

test('an unknown agent on a priority falls back to founder, never to builder', () => {
  const parsed = parsePresidentReport(GOOD);
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.deepEqual(
    parsed.report.priorities.map((p) => p.agent),
    ['founder', 'builder', 'founder'],
  );
});

test('priorities are capped at five, in the order given', () => {
  const many = Array.from({ length: 8 }, (_, i) => ({
    project: 'P',
    title: `t${i}`,
    why: '',
    agent: 'observer',
    prompt: 'p',
  }));
  const text = '```json\n' + JSON.stringify({ where_we_are: 'x', priorities: many, health: 'green' }) + '\n```';
  const parsed = parsePresidentReport(text);
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.deepEqual(parsed.report.priorities.map((p) => p.title), ['t0', 't1', 't2', 't3', 't4']);
});

test('a block without where_we_are or health is a loud failure', () => {
  const noWhere = parsePresidentReport('```json\n{"health":"green"}\n```');
  assert.equal(noWhere.ok, false);
  if (!noWhere.ok) assert.match(noWhere.reason, /where_we_are/);

  const badHealth = parsePresidentReport('```json\n{"where_we_are":"x","health":"blue"}\n```');
  assert.equal(badHealth.ok, false);
  if (!badHealth.ok) assert.match(badHealth.reason, /health/);

  const none = parsePresidentReport('I could not produce a report.');
  assert.equal(none.ok, false);
});

test('the markdown carries every dimension, priority and question', () => {
  const parsed = parsePresidentReport(GOOD);
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  const md = presidentToMarkdown(parsed.report, new Date('2026-10-12T04:00:00Z'));
  assert.match(md, /^### 2026-10-12 — orange/);
  assert.match(md, /\*\*Product\*\*/);
  assert.match(md, /\*\*Legal\*\*/);
  assert.match(md, /CGV for 11bis/);
  assert.match(md, /1\. \*\*Put a price on it\*\* · LaunchPad \(founder\)/);
  assert.match(md, /Kill Vibrand\?/);
});
