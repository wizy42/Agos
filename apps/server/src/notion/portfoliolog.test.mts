import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { PresidentReport } from '@cockpit/core';
import { appendPresidentReport, resolvePortfolioLog } from './portfoliolog.ts';

/** A hub page with the given child pages, recording creates and appends. */
function stub(children: { id: string; title: string }[]) {
  const created: Record<string, any>[] = [];
  const appended: { block_id: string; children: Record<string, any>[] }[] = [];
  const client = {
    blocks: {
      children: {
        list: async () => ({
          results: children.map((c) => ({ id: c.id, type: 'child_page', child_page: { title: c.title } })),
          has_more: false,
          next_cursor: null,
        }),
        append: async (arg: any) => {
          appended.push(arg);
          return {};
        },
      },
    },
    pages: {
      create: async (arg: any) => {
        created.push(arg);
        return { id: 'new-log' };
      },
    },
  };
  return { client, created, appended };
}

const report: PresidentReport = {
  where_we_are: 'Fourteen projects.',
  dimensions: [{ dimension: 'legal', where_we_are: 'Nothing signed.', missing: ['CGV'] }],
  priorities: [{ project: 'LaunchPad', title: 'Price it', why: 'w', agent: 'founder', prompt: 'p' }],
  questions_for_ceo: ['Kill Vibrand?'],
  health: 'orange',
};

test('reuses an existing Portfolio Log under the hub', async () => {
  const { client, created } = stub([{ id: 'existing', title: 'Portfolio Log' }]);
  assert.equal(await resolvePortfolioLog(client as never, 'hub'), 'existing');
  assert.equal(created.length, 0);
});

test('creates the Portfolio Log under the hub on first use', async () => {
  const { client, created } = stub([{ id: 'other', title: 'Dream Log' }]);
  assert.equal(await resolvePortfolioLog(client as never, 'hub'), 'new-log');
  assert.equal(created[0]!.parent.page_id, 'hub');
  assert.equal(created[0]!.properties.title.title[0].text.content, 'Portfolio Log');
});

test('appends the report as blocks carrying every section', async () => {
  const { client, appended } = stub([]);
  await appendPresidentReport(client as never, 'log', report, new Date('2026-10-12T04:00:00Z'));
  const text = appended
    .flatMap((a) => a.children)
    .map((b) => (b[b.type]?.rich_text ?? []).map((t: any) => t.text.content).join(''))
    .join('\n');
  assert.equal(appended[0]!.block_id, 'log');
  assert.match(text, /2026-10-12 — orange/);
  assert.match(text, /CGV/);
  assert.match(text, /Price it/);
  assert.match(text, /Kill Vibrand\?/);
});
