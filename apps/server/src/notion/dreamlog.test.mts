import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { DreamReport } from '@cockpit/core';
import { appendDream, updateRegistryRow } from './dreamlog.ts';
import type { RegistrySchema } from './registry.ts';

/** Captures the block payloads that would go to Notion. */
function stub() {
  const appended: Record<string, any>[] = [];
  const updates: Record<string, any>[] = [];
  const client = {
    blocks: {
      children: {
        append: async (arg: any) => {
          appended.push(...arg.children);
          return {};
        },
      },
    },
    pages: {
      update: async (arg: any) => {
        updates.push(arg);
        return {};
      },
    },
  };
  return { client, appended, updates };
}

const WHEN = new Date('2026-08-01T02:00:00Z');

function report(over: Partial<DreamReport> = {}): DreamReport {
  return {
    project: 'LaunchPad',
    where_we_are: 'Short summary.',
    what_moved: ['a'],
    risks: ['b'],
    proposed_next_actions: [{ title: 'Ship it', why: 'revenue', agent: 'builder', prompt: 'go' }],
    questions_for_ceo: ['c'],
    health: 'orange',
    ...over,
  };
}

/** Every text fragment Notion would receive, flattened. */
function allText(blocks: Record<string, any>[]): string {
  return blocks
    .map((b) => (b[b.type as string]?.rich_text ?? []).map((t: any) => t.text.content).join(''))
    .join('\n');
}

test('a long section survives the trip instead of being truncated', async () => {
  const long = 'A'.repeat(5000);
  const { client, appended } = stub();

  await appendDream(client as never, 'page', report({ where_we_are: long }), WHEN);

  const rendered = allText(appended);
  assert.equal(
    rendered.includes(long),
    true,
    'the full 5000-character section should reach Notion, split across rich-text elements',
  );
});

test('no single rich-text element exceeds Notion 2000-character cap', async () => {
  const { client, appended } = stub();

  await appendDream(
    client as never,
    'page',
    report({
      where_we_are: 'B'.repeat(4500),
      risks: ['C'.repeat(3000)],
      what_moved: ['D'.repeat(2500)],
    }),
    WHEN,
  );

  for (const block of appended) {
    for (const rt of block[block.type as string]?.rich_text ?? []) {
      assert.ok(
        rt.text.content.length <= 2000,
        `rich-text element of ${rt.text.content.length} chars exceeds the API limit`,
      );
    }
  }
});

test('no block exceeds Notion 100 rich-text element cap', async () => {
  const { client, appended } = stub();
  // 300k characters would need 150 elements if chunked naively.
  await appendDream(client as never, 'page', report({ where_we_are: 'E'.repeat(300_000) }), WHEN);

  for (const block of appended) {
    const rt = block[block.type as string]?.rich_text ?? [];
    assert.ok(rt.length <= 100, `block carries ${rt.length} rich-text elements`);
  }
});

test('bold runs survive alongside chunking', async () => {
  const { client, appended } = stub();
  await appendDream(client as never, 'page', report(), WHEN);

  const bolded = appended
    .flatMap((b) => b[b.type as string]?.rich_text ?? [])
    .filter((t: any) => t.annotations?.bold)
    .map((t: any) => t.text.content);

  assert.ok(bolded.includes('What moved'), 'section labels should stay bold');
  assert.ok(bolded.includes('Ship it'), 'action titles should stay bold');
});

test('appends are batched at 100 blocks per call', async () => {
  const calls: number[] = [];
  const client = {
    blocks: {
      children: {
        append: async (arg: any) => {
          calls.push(arg.children.length);
          return {};
        },
      },
    },
  };

  await appendDream(
    client as never,
    'page',
    report({ risks: Array.from({ length: 250 }, (_, i) => `risk ${i}`) }),
    WHEN,
  );

  assert.ok(calls.length > 1, 'should have needed more than one append call');
  for (const n of calls) assert.ok(n <= 100, `append call carried ${n} blocks`);
});

test('registry mirror writes health, date and next step', async () => {
  const { client, updates } = stub();
  const schema: RegistrySchema = {
    databaseId: 'db',
    dataSourceId: 'ds',
    props: {
      name: 'Name',
      projectPage: 'Project page',
      tier: 'Tier',
      status: 'Status',
      repoPath: 'Repo path',
      dream: 'Dream',
      lastDream: 'Last dream',
      nextStep: 'Next step',
    },
    missing: [],
  };

  await updateRegistryRow(client as never, schema, 'row-id', report(), WHEN);

  const props = updates[0]!.properties;
  assert.equal(props.Status.select.name, 'orange');
  assert.equal(props['Last dream'].date.start, WHEN.toISOString());
  assert.equal(props['Next step'].rich_text[0].text.content, 'Ship it');
});

test('a registry missing properties is written to, not crashed on', async () => {
  const { client, updates } = stub();
  const schema: RegistrySchema = {
    databaseId: 'db',
    dataSourceId: 'ds',
    props: {
      name: 'Name',
      projectPage: null,
      tier: null,
      status: null,
      repoPath: null,
      dream: null,
      lastDream: 'Last dream',
      nextStep: null,
    },
    missing: ['status', 'nextStep'],
  };

  await updateRegistryRow(client as never, schema, 'row-id', report(), WHEN);
  assert.deepEqual(Object.keys(updates[0]!.properties), ['Last dream']);
});
