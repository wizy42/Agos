import { Client } from '@notionhq/client';
import { HEALTHS, TIERS, type Health, type Project, type Tier } from '@cockpit/core';

/**
 * Reads the Cockpit Registry database.
 *
 * Two things this deliberately does not do:
 *  - hardcode property names or ids (they are introspected at boot, so renaming
 *    "Next step" in Notion does not break the server), and
 *  - query by `database_id` (the 2025-09 API queries a *data source* under a
 *    database; a database can carry several).
 */

/** Canonical registry fields → the data-source property name actually found. */
export interface RegistrySchema {
  databaseId: string;
  dataSourceId: string;
  props: {
    name: string;
    projectPage: string | null;
    tier: string | null;
    status: string | null;
    repoPath: string | null;
    dream: string | null;
    lastDream: string | null;
    nextStep: string | null;
  };
  /** Fields the introspection could not resolve, for a boot-time warning. */
  missing: string[];
}

interface FieldSpec {
  key: Exclude<keyof RegistrySchema['props'], 'name'>;
  /** Accepted Notion property types, in preference order. */
  types: string[];
  /** Accepted names, normalized, in preference order. */
  aliases: string[];
}

const FIELDS: FieldSpec[] = [
  { key: 'projectPage', types: ['url'], aliases: ['projectpage', 'page', 'notionpage', 'link'] },
  { key: 'tier', types: ['select', 'status'], aliases: ['tier'] },
  { key: 'status', types: ['select', 'status'], aliases: ['status', 'health'] },
  { key: 'repoPath', types: ['rich_text'], aliases: ['repopath', 'repo', 'path'] },
  { key: 'dream', types: ['checkbox'], aliases: ['dream', 'dreams', 'dreamenabled'] },
  { key: 'lastDream', types: ['date'], aliases: ['lastdream', 'lastdreamed', 'lastdreamat'] },
  { key: 'nextStep', types: ['rich_text'], aliases: ['nextstep', 'next', 'nextaction'] },
];

const normalize = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/** Bare 32-char hex form, so ids and URLs compare equal regardless of dashes. */
export function normalizeNotionId(raw: string): string | null {
  // "Copy link" appends ?pvs=4 or ?source=copy_link; those carry hex letters
  // that would otherwise shift the id we take from the end.
  const hex = raw.replace(/[?#].*$/s, '').toLowerCase().replace(/[^0-9a-f]/g, '');
  // A URL contributes trailing/leading noise; the page id is the last 32 hex chars.
  if (hex.length < 32) return null;
  return hex.slice(hex.length - 32);
}

/**
 * Resolve the registry's data source and map canonical fields onto whatever
 * property names the database actually has.
 */
export async function introspectRegistry(
  notion: Client,
  databaseId: string,
): Promise<RegistrySchema> {
  const db = await notion.databases.retrieve({ database_id: databaseId });

  const sources = 'data_sources' in db ? db.data_sources : [];
  const first = sources[0];
  if (!first) {
    throw new Error(
      `Notion database ${databaseId} exposes no data sources. ` +
        `Confirm the integration is shared with the "Cockpit Registry" database.`,
    );
  }

  const ds = await notion.dataSources.retrieve({ data_source_id: first.id });
  const properties: Record<string, { type: string }> = ds.properties ?? {};
  const entries = Object.entries(properties);

  const titleEntry = entries.find(([, p]) => p.type === 'title');
  if (!titleEntry) {
    throw new Error(`Registry data source ${first.id} has no title property.`);
  }

  const props = {
    name: titleEntry[0],
    projectPage: null,
    tier: null,
    status: null,
    repoPath: null,
    dream: null,
    lastDream: null,
    nextStep: null,
  } as RegistrySchema['props'];

  const taken = new Set<string>([titleEntry[0]]);
  const missing: string[] = [];

  for (const field of FIELDS) {
    // Prefer an exact alias match of the right type, then any free property of
    // the right type whose name contains an alias.
    let match = entries.find(
      ([n, p]) =>
        !taken.has(n) && field.types.includes(p.type) && field.aliases.includes(normalize(n)),
    );
    match ??= entries.find(
      ([n, p]) =>
        !taken.has(n) &&
        field.types.includes(p.type) &&
        field.aliases.some((a) => normalize(n).includes(a)),
    );

    if (match) {
      props[field.key] = match[0];
      taken.add(match[0]);
    } else {
      missing.push(field.key);
    }
  }

  return { databaseId, dataSourceId: first.id, props, missing };
}

/* ---------- property readers (tolerant: a wrong-shaped value reads as null) ---------- */

type Prop = Record<string, unknown>;

function plain(props: Prop, key: string | null): string | null {
  if (!key) return null;
  const p = props[key] as { type?: string; rich_text?: { plain_text: string }[]; title?: { plain_text: string }[] } | undefined;
  const parts = p?.rich_text ?? p?.title;
  if (!parts?.length) return null;
  const text = parts.map((t) => t.plain_text).join('').trim();
  return text || null;
}

function url(props: Prop, key: string | null): string | null {
  if (!key) return null;
  const p = props[key] as { url?: string | null } | undefined;
  return p?.url ?? null;
}

function selectName(props: Prop, key: string | null): string | null {
  if (!key) return null;
  const p = props[key] as { select?: { name: string } | null; status?: { name: string } | null } | undefined;
  return p?.select?.name ?? p?.status?.name ?? null;
}

function checkbox(props: Prop, key: string | null): boolean {
  if (!key) return false;
  const p = props[key] as { checkbox?: boolean } | undefined;
  return p?.checkbox === true;
}

function date(props: Prop, key: string | null): string | null {
  if (!key) return null;
  const p = props[key] as { date?: { start: string } | null } | undefined;
  return p?.date?.start ?? null;
}

const asTier = (v: string | null): Tier | null =>
  TIERS.includes(v as Tier) ? (v as Tier) : null;

const asHealth = (v: string | null): Health | null =>
  HEALTHS.includes(v as Health) ? (v as Health) : null;

/** A registry row, before local git/session activity is joined in. */
export type RegistryRow = Omit<Project, 'activity'>;

/** Query every row of the registry, paginating fully. */
export async function fetchRegistryRows(
  notion: Client,
  schema: RegistrySchema,
): Promise<RegistryRow[]> {
  const rows: RegistryRow[] = [];
  let cursor: string | undefined;

  do {
    const res = await notion.dataSources.query({
      data_source_id: schema.dataSourceId,
      start_cursor: cursor,
      page_size: 100,
    });

    for (const page of res.results) {
      if (!('properties' in page)) continue;
      const props = page.properties as Prop;

      rows.push({
        id: page.id,
        name: plain(props, schema.props.name) ?? 'Untitled',
        projectPageUrl: url(props, schema.props.projectPage),
        registryRowUrl: 'url' in page ? page.url : `https://notion.so/${page.id.replace(/-/g, '')}`,
        tier: asTier(selectName(props, schema.props.tier)),
        status: asHealth(selectName(props, schema.props.status)),
        repoPath: plain(props, schema.props.repoPath),
        dream: checkbox(props, schema.props.dream),
        lastDream: date(props, schema.props.lastDream),
        nextStep: plain(props, schema.props.nextStep),
      });
    }

    cursor = res.has_more ? (res.next_cursor ?? undefined) : undefined;
  } while (cursor);

  return rows;
}

/**
 * Records where a project's clone lives on this machine. Written by
 * `npm run link-repos` once a clone is matched by remote — the registry is the
 * source of truth for paths, so a fresh machine only needs this run once.
 */
export async function writeRepoPath(
  notion: Client,
  schema: RegistrySchema,
  rowId: string,
  repoPath: string,
): Promise<void> {
  if (!schema.props.repoPath) {
    throw new Error('The registry has no Repo path property to write to.');
  }
  await notion.pages.update({
    page_id: rowId,
    properties: {
      [schema.props.repoPath]: { rich_text: [{ type: 'text', text: { content: repoPath } }] },
    } as never,
  });
}
