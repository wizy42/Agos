import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readProjectPage } from './projectPage.ts';

/* Blocks shaped as the Notion API returns them. */
const rt = (s: string) => [{ plain_text: s }];
const h2 = (s: string) => ({ type: 'heading_2', heading_2: { rich_text: rt(s) } });
const p = (s: string) => ({ type: 'paragraph', paragraph: { rich_text: rt(s) } });
const li = (s: string) => ({
  type: 'bulleted_list_item',
  bulleted_list_item: { rich_text: rt(s) },
});
const row = (...cells: string[]) => ({
  type: 'table_row',
  table_row: { cells: cells.map(rt) },
});
const table = (id: string) => ({ type: 'table', id, has_children: true });

/** A client whose children.list is driven by a map of blockId → blocks. */
function stub(pages: Record<string, unknown[]>, opts: { throwOn?: string } = {}) {
  let calls = 0;
  const client = {
    blocks: {
      children: {
        list: async ({ block_id }: { block_id: string }) => {
          calls++;
          if (opts.throwOn === block_id) throw new Error('boom');
          return { results: pages[block_id] ?? [], has_more: false, next_cursor: null };
        },
      },
    },
  };
  return { client, calls: () => calls };
}

/* --------------------------- the templated shape --------------------------- */

const TEMPLATED = {
  page: [
    h2('AGENT_CONTEXT'),
    table('t1'),
    h2('BACKLOG'),
    li('P0 Wire Stripe checkout'),
    h2('ARCHITECTURE'),
    p('Deno edge functions, pgvector, and a great deal of prose nobody needs here.'),
    h2('DECISION LOG'),
    li('2026-06-10 — Guidance-first v1 — LOCKED'),
    { type: 'child_page', child_page: { title: 'Marketing — Strategy' } },
  ],
  t1: [row('Field', 'Value'), row('Maturity', 'SHIPPING'), row('MRR', '$0'), row('Primary Blocker', 'Stripe checkout unconfirmed')],
};

test('pulls the templated sections and names them', async () => {
  const { client } = stub(TEMPLATED);
  const ctx = await readProjectPage(client as never, 'page');

  assert.deepEqual(ctx.sections, ['AGENT_CONTEXT', 'DECISION LOG', 'BACKLOG']);
  assert.ok(ctx.text);
  assert.match(ctx.text, /Maturity \| SHIPPING/);
  assert.match(ctx.text, /Primary Blocker \| Stripe checkout unconfirmed/);
  assert.match(ctx.text, /2026-06-10 .* LOCKED/);
});

test('a section stops at the next heading of the same level', async () => {
  const { client } = stub(TEMPLATED);
  const ctx = await readProjectPage(client as never, 'page');
  // ARCHITECTURE sits between BACKLOG and DECISION LOG and is not wanted.
  assert.doesNotMatch(ctx.text!, /pgvector/);
});

test('sub-pages are not followed', async () => {
  const { client } = stub(TEMPLATED);
  const ctx = await readProjectPage(client as never, 'page');
  assert.doesNotMatch(ctx.text!, /Marketing/);
});

/* ----------------------- pages that predate the template ------------------- */

test('a page with no templated sections falls back to its opening', async () => {
  const { client } = stub({
    page: [
      p('LaunchPad is the AI Operations Layer for vibe-coded SaaS apps.'),
      h2('Project Status'),
      li('Stage: v1 code-complete'),
    ],
  });

  const ctx = await readProjectPage(client as never, 'page');
  assert.deepEqual(ctx.sections, []);
  assert.match(ctx.text!, /AI Operations Layer/);
  assert.match(ctx.text!, /v1 code-complete/);
});

/* --------------------------- degrading gracefully -------------------------- */

test('an unreadable page yields null rather than throwing', async () => {
  const { client } = stub({}, { throwOn: 'page' });
  assert.deepEqual(await readProjectPage(client as never, 'page'), { text: null, sections: [] });
});

test('an empty page yields null', async () => {
  const { client } = stub({ page: [] });
  assert.equal((await readProjectPage(client as never, 'page')).text, null);
});

test('a failing table fetch does not lose the rest of the page', async () => {
  const { client } = stub(TEMPLATED, { throwOn: 't1' });
  const ctx = await readProjectPage(client as never, 'page');
  assert.match(ctx.text!, /LOCKED/);
});

/* -------------------------------- bounded --------------------------------- */

test('output is clamped so one page cannot dominate the prompt', async () => {
  const { client } = stub({
    page: Array.from({ length: 400 }, (_, i) => p(`line ${i} ${'x'.repeat(80)}`)),
  });

  const ctx = await readProjectPage(client as never, 'page', 2000);
  assert.ok(ctx.text!.length <= 2100, `got ${ctx.text!.length} chars`);
  assert.match(ctx.text!, /truncated/);
});

test('a page that paginates forever cannot spin the API', async () => {
  let calls = 0;
  const client = {
    blocks: {
      children: {
        list: async () => {
          calls++;
          return { results: [p('again')], has_more: true, next_cursor: 'more' };
        },
      },
    },
  };

  await readProjectPage(client as never, 'page');
  assert.ok(calls <= 40, `made ${calls} API calls`);
});

test('a sub-heading inside a wanted section travels with it', async () => {
  // The template nests "### Repo & Deploy" under "## AGENT_CONTEXT", and that
  // table is where the GitHub URL lives. A section must not stop at a deeper
  // heading, only at one of the same or higher level.
  const { client } = stub({
    page: [
      h2('AGENT_CONTEXT'),
      { type: 'heading_3', heading_3: { rich_text: rt('Repo & Deploy') } },
      table('repo'),
      h2('ARCHITECTURE'),
      p('not wanted'),
    ],
    repo: [row('GitHub', 'https://github.com/wizy42/autobot33')],
  });

  const ctx = await readProjectPage(client as never, 'page');
  assert.match(ctx.text!, /Repo & Deploy/);
  assert.match(ctx.text!, /github\.com\/wizy42\/autobot33/);
  assert.doesNotMatch(ctx.text!, /not wanted/);
});
