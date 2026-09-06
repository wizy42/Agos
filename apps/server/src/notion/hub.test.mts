import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cleanTitle, listCandidates, listTierPages, registerProject } from './hub.ts';
import { normalizeNotionId } from './registry.ts';

const child = (id: string, title: string) => ({ type: 'child_page', id, child_page: { title } });

/** A client whose children.list is driven by a map of pageId → blocks. */
function stub(pages: Record<string, unknown[]>) {
  const created: unknown[] = [];
  const client = {
    blocks: {
      children: {
        list: async ({ block_id }: { block_id: string }) => ({
          results: pages[block_id] ?? [],
          has_more: false,
          next_cursor: null,
        }),
      },
    },
    pages: {
      create: async (arg: unknown) => {
        created.push(arg);
        return { id: 'new-row-id' };
      },
    },
  };
  return { client, created };
}

/** Notion ids are 32 hex chars, dashed or not; the fixtures must look like one. */
const id = (n: number) => n.toString(16).padStart(32, '0');
const dashed = (raw: string) =>
  raw.replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, '$1-$2-$3-$4-$5');

const P_BOTAI = id(0xb07a1);
const P_WAYDONE = id(0x4a4d);
const P_11BIS = id(0x11b15);
const P_LAUNCHPAD = id(0x1a0c);
const P_DEAD = id(0xdead);

const HUB = {
  hub: [
    { type: 'paragraph', paragraph: { rich_text: [] } },
    child('t-ship', '🟢 SHIP NOW — Revenue-ready products'),
    child('t-build', '🟡 BUILD NEXT — Strong plans, needs code sprint'),
    child('t-bets', '🔵 STRATEGIC BETS — High ceiling, longer runway'),
    child('t-ideas', '💡 IDEAS — Planned, not yet prioritized'),
    child('t-arch', '🗄️ ARCHIVED — Inactive projects'),
    child('analysis', '📊 Portfolio Strategic Analysis — April 2026'),
  ],
  // Notion hands back dashed ids; the registry may hold them in any format.
  't-ship': [
    child(dashed(P_BOTAI), '🧠 04 BotAI [Lovable]'),
    child(dashed(P_WAYDONE), '🤖 14 Waydone [Lovable]'),
  ],
  't-build': [child(dashed(P_11BIS), '💼 11bis AI Web Engineer')],
  't-bets': [child(dashed(P_LAUNCHPAD), '🚀 20 — LaunchPad — Operations Layer for Vibe-Coded Apps')],
  't-ideas': [],
  't-arch': [child(dashed(P_DEAD), '💀 99 Dead Project')],
};

/* -------------------------------- titles --------------------------------- */

test('cleanTitle strips emoji, index, tags and the dash suffix', () => {
  assert.equal(cleanTitle('🧠 04 BotAI [Lovable]'), 'BotAI');
  assert.equal(cleanTitle('🚀 20 — LaunchPad — Operations Layer for Vibe-Coded Apps'), 'LaunchPad');
  assert.equal(cleanTitle('🤖 14 Waydone [Lovable]'), 'Waydone');
  assert.equal(cleanTitle('03 SupportAI'), 'SupportAI');
  assert.equal(cleanTitle(' Teaching OS'), 'Teaching OS');
});

test('cleanTitle keeps a number that is part of the name', () => {
  // "11bis" is the project, not an index. The user can still edit the result.
  assert.equal(cleanTitle('💼 11bis AI Web Engineer'), '11bis AI Web Engineer');
  assert.equal(cleanTitle('🎛️ 21bis SaaS Panel'), '21bis SaaS Panel');
});

test('cleanTitle never returns empty', () => {
  assert.equal(cleanTitle('🚀'), '🚀');
  assert.equal(cleanTitle('42'), '42');
});

/* --------------------------------- ids ----------------------------------- */

test('a "Copy link" URL with a query suffix still yields the page id', () => {
  // ?source=copy_link carries hex letters; they must not shift the id.
  const url = `https://www.notion.so/LaunchPad-${P_LAUNCHPAD}?source=copy_link`;
  assert.equal(normalizeNotionId(url), P_LAUNCHPAD);
  assert.equal(normalizeNotionId(`${dashed(P_LAUNCHPAD)}#block`), P_LAUNCHPAD);
  assert.equal(normalizeNotionId(dashed(P_LAUNCHPAD).toUpperCase()), P_LAUNCHPAD);
});

/* ------------------------------ hub structure ----------------------------- */

test('tier pages are found by name, other hub children ignored', async () => {
  const { client } = stub(HUB);
  const tiers = await listTierPages(client as never, 'hub');
  assert.deepEqual(
    [...tiers.entries()],
    [
      ['SHIP NOW', 't-ship'],
      ['BUILD NEXT', 't-build'],
      ['STRATEGIC BETS', 't-bets'],
      ['IDEAS', 't-ideas'],
      ['ARCHIVED', 't-arch'],
    ],
  );
});

test('candidates exclude registered pages and come in tier order', async () => {
  const { client } = stub(HUB);
  // Registered ids arrive in whatever format the registry URL had.
  const registered = [`https://www.notion.so/LaunchPad-${P_LAUNCHPAD}?pvs=1`, dashed(P_BOTAI).toUpperCase()];
  const out = await listCandidates(client as never, 'hub', registered);

  assert.deepEqual(
    out.map((c) => [c.tier, c.suggestedName]),
    [
      ['SHIP NOW', 'Waydone'],
      ['BUILD NEXT', '11bis AI Web Engineer'],
      ['ARCHIVED', 'Dead Project'],
    ],
  );
  assert.equal(out[0]!.pageId, dashed(P_WAYDONE));
  assert.equal(out[0]!.url, `https://www.notion.so/${P_WAYDONE}`);
});

test('a hub missing a tier page still yields the others', async () => {
  const { client } = stub({ ...HUB, hub: HUB.hub.filter((b: any) => b.id !== 't-ideas') });
  const out = await listCandidates(client as never, 'hub', []);
  assert.ok(out.length > 0);
  assert.ok(!out.some((c) => c.tier === 'IDEAS'));
});

/* ------------------------------ registration ----------------------------- */

const schema = {
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

test('registerProject writes name, page, tier, and leaves Dream off', async () => {
  const { client, created } = stub({});
  const res = await registerProject(client as never, schema, {
    pageId: dashed(P_WAYDONE),
    name: '  Waydone ',
    tier: 'SHIP NOW',
  });

  assert.equal(res.rowId, 'new-row-id');
  const arg = created[0] as any;
  assert.deepEqual(arg.parent, { type: 'data_source_id', data_source_id: 'ds' });
  assert.equal(arg.properties.Name.title[0].text.content, 'Waydone');
  assert.equal(arg.properties['Project page'].url, `https://www.notion.so/${P_WAYDONE}`);
  assert.equal(arg.properties.Tier.select.name, 'SHIP NOW');
  assert.equal(arg.properties.Dream.checkbox, false);
});

test('registerProject refuses an empty name or unknown tier', async () => {
  const { client } = stub({});
  await assert.rejects(
    () => registerProject(client as never, schema, { pageId: 'x', name: '  ', tier: 'SHIP NOW' }),
    /needs a name/,
  );
  await assert.rejects(
    () => registerProject(client as never, schema, { pageId: 'x', name: 'X', tier: 'NOPE' as never }),
    /Unknown tier/,
  );
});

test('registerProject tolerates a registry missing optional properties', async () => {
  const { client, created } = stub({});
  const sparse = { ...schema, props: { ...schema.props, projectPage: null, tier: null, dream: null } };
  await registerProject(client as never, sparse, { pageId: 'x', name: 'X', tier: 'IDEAS' });
  assert.deepEqual(Object.keys((created[0] as any).properties), ['Name']);
});
