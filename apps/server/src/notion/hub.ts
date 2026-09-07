import type { Client } from '@notionhq/client';
import { TIERS, type Tier } from '@cockpit/core';
import { normalizeNotionId, type RegistrySchema } from './registry.ts';

/**
 * Reads the hub page's structure so a project can be registered by picking it
 * from a list instead of hand-copying a URL into Notion.
 *
 * The hub is one page whose children are the five tier pages, whose children
 * are the project pages. That shape is the portfolio's own convention, so it is
 * read at runtime rather than hardcoded: a tier page renamed or reordered still
 * resolves as long as its title carries the tier name.
 */

export interface Candidate {
  pageId: string;
  /** The page title as Notion has it: "🧠 04 BotAI [Lovable]". */
  title: string;
  /** A registry-friendly name derived from the title, editable before saving. */
  suggestedName: string;
  tier: Tier;
  url: string;
}

type Block = Record<string, any>;

/** Every child_page block under a page, following pagination. */
async function childPages(notion: Client, pageId: string): Promise<{ id: string; title: string }[]> {
  const out: { id: string; title: string }[] = [];
  let cursor: string | undefined;
  let guard = 0;

  do {
    const res = await notion.blocks.children.list({
      block_id: pageId,
      start_cursor: cursor,
      page_size: 100,
    });
    for (const block of res.results as Block[]) {
      if (block.type === 'child_page') {
        out.push({ id: String(block.id), title: String(block.child_page?.title ?? '') });
      }
    }
    cursor = res.has_more ? (res.next_cursor ?? undefined) : undefined;
  } while (cursor && ++guard < 10);

  return out;
}

/** Which tier a page title names, if any. */
function tierOf(title: string): Tier | null {
  const upper = title.toUpperCase();
  return TIERS.find((t) => upper.includes(t)) ?? null;
}

/**
 * A registry name from a hub page title.
 *
 *   "🧠 04 BotAI [Lovable]"                         → "BotAI"
 *   "🚀 20 — LaunchPad — Operations Layer for …"    → "LaunchPad"
 *   "💼 11bis AI Web Engineer"                       → "11bis AI Web Engineer"
 *
 * The number is dropped only when it is a separate token — "11bis" is a name,
 * not an index. The user edits the result before saving, so this only needs to
 * be a good default, not a perfect one.
 */
export function cleanTitle(raw: string): string {
  const cleaned = raw
    .replace(/^[^\p{L}\p{N}]+/u, '')
    .replace(/^\d+(?:\s+|\s*[—–-]\s*)(?=\p{L})/u, '')
    .split(/\s+[—–]\s+/)[0]!
    .replace(/\s*\[[^\]]*\]/g, '')
    .trim();
  return cleaned || raw.trim();
}

export const pageUrl = (id: string): string =>
  `https://www.notion.so/${id.replace(/-/g, '')}`;

/** Tier pages under the hub, keyed by tier. Missing tiers are simply absent. */
export async function listTierPages(notion: Client, hubPageId: string): Promise<Map<Tier, string>> {
  const tiers = new Map<Tier, string>();
  for (const page of await childPages(notion, hubPageId)) {
    const tier = tierOf(page.title);
    if (tier && !tiers.has(tier)) tiers.set(tier, page.id);
  }
  return tiers;
}

/**
 * Project pages in the hub that are not yet in the registry, in tier order.
 * `registered` holds the page ids of existing rows, in any id format.
 */
export async function listCandidates(
  notion: Client,
  hubPageId: string,
  registered: Iterable<string>,
): Promise<Candidate[]> {
  const taken = new Set([...registered].map((id) => normalizeNotionId(id)).filter(Boolean));
  const tiers = await listTierPages(notion, hubPageId);
  const out: Candidate[] = [];

  for (const tier of TIERS) {
    const tierPageId = tiers.get(tier);
    if (!tierPageId) continue;

    for (const page of await childPages(notion, tierPageId)) {
      if (taken.has(normalizeNotionId(page.id))) continue;
      out.push({
        pageId: page.id,
        title: page.title,
        suggestedName: cleanTitle(page.title),
        tier,
        url: pageUrl(page.id),
      });
    }
  }

  return out;
}

export interface RegisterInput {
  pageId: string;
  name: string;
  tier: Tier;
}

/**
 * Creates the registry row. Dream is left unticked: opting a project into the
 * nightly loop is a cost decision the founder makes in Notion, not a default.
 */
export async function registerProject(
  notion: Client,
  schema: RegistrySchema,
  input: RegisterInput,
): Promise<{ rowId: string; url: string }> {
  const name = input.name.trim();
  if (!name) throw new Error('A project needs a name.');
  if (!TIERS.includes(input.tier)) throw new Error(`Unknown tier ${JSON.stringify(input.tier)}.`);

  const text = (content: string) => [{ type: 'text', text: { content: content.slice(0, 2000) } }];
  const properties: Record<string, unknown> = {
    [schema.props.name]: { title: text(name) },
  };
  if (schema.props.projectPage) properties[schema.props.projectPage] = { url: pageUrl(input.pageId) };
  if (schema.props.tier) properties[schema.props.tier] = { select: { name: input.tier } };
  if (schema.props.dream) properties[schema.props.dream] = { checkbox: false };

  const page = await notion.pages.create({
    parent: { type: 'data_source_id', data_source_id: schema.dataSourceId },
    properties,
  } as never);

  return { rowId: page.id, url: pageUrl(page.id) };
}
