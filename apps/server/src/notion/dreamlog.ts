import type { Client } from '@notionhq/client';
import type { DreamReport, Project } from '@cockpit/core';
import { reportToMarkdown } from '../dream/contract.ts';
import type { RegistrySchema } from './registry.ts';
import { normalizeNotionId } from './registry.ts';

/**
 * Dream Log pages are created lazily — only for projects opted into the loop,
 * and only on their first dream. Nothing existing is restructured: the log is a
 * new child page under the project's own page, or under its registry row when
 * the project page is unreachable.
 */

const DREAM_LOG_TITLE = 'Dream Log';

const text = (content: string) => ({
  type: 'text' as const,
  text: { content: content.slice(0, 2000) },
});

/** Renders a Markdown-ish line as a Notion block, keeping bold and bullets. */
function toBlock(line: string): Record<string, unknown> | null {
  if (!line.trim()) return null;

  if (line.startsWith('### ')) {
    return {
      object: 'block',
      type: 'heading_3',
      heading_3: { rich_text: [text(line.slice(4))] },
    };
  }

  if (line.startsWith('- ')) {
    return {
      object: 'block',
      type: 'bulleted_list_item',
      bulleted_list_item: { rich_text: richText(line.slice(2)) },
    };
  }

  return { object: 'block', type: 'paragraph', paragraph: { rich_text: richText(line) } };
}

/** Splits `**bold**` runs into Notion rich-text segments. */
function richText(line: string): Record<string, unknown>[] {
  const parts = line.split(/(\*\*[^*]+\*\*)/g).filter(Boolean);
  return parts.map((part) => {
    const bold = part.startsWith('**') && part.endsWith('**');
    return {
      type: 'text',
      text: { content: (bold ? part.slice(2, -2) : part).slice(0, 2000) },
      annotations: bold ? { bold: true } : undefined,
    };
  });
}

/** Finds an existing "Dream Log" child page under a parent, if there is one. */
async function findDreamLog(notion: Client, parentPageId: string): Promise<string | null> {
  let cursor: string | undefined;
  do {
    const res = await notion.blocks.children.list({
      block_id: parentPageId,
      start_cursor: cursor,
      page_size: 100,
    });
    for (const block of res.results) {
      if (
        'type' in block &&
        block.type === 'child_page' &&
        block.child_page.title.trim() === DREAM_LOG_TITLE
      ) {
        return block.id;
      }
    }
    cursor = res.has_more ? (res.next_cursor ?? undefined) : undefined;
  } while (cursor);

  return null;
}

async function createDreamLog(notion: Client, parentPageId: string): Promise<string> {
  const page = await notion.pages.create({
    parent: { type: 'page_id', page_id: parentPageId },
    icon: { type: 'emoji', emoji: '🌙' },
    properties: { title: { title: [text(DREAM_LOG_TITLE)] } },
    children: [
      {
        object: 'block',
        type: 'paragraph',
        paragraph: {
          rich_text: [
            text(
              'Overnight reviews written by Cockpit. Each dream appends a dated section below; ' +
                'the latest health and next step are mirrored onto the Cockpit Registry row.',
            ),
          ],
        },
      },
    ],
  });
  return page.id;
}

/**
 * Resolves the project's Dream Log page, creating it on first use.
 * Prefers the existing project page; falls back to the registry row (§6).
 */
export async function resolveDreamLog(notion: Client, project: Project): Promise<string> {
  const projectPageId = project.projectPageUrl
    ? normalizeNotionId(project.projectPageUrl)
    : null;

  const parents = [projectPageId, project.id].filter((id): id is string => Boolean(id));

  let lastError: unknown;
  for (const parent of parents) {
    try {
      return (await findDreamLog(notion, parent)) ?? (await createDreamLog(notion, parent));
    } catch (err) {
      lastError = err;
    }
  }

  throw new Error(
    `Could not open or create a Dream Log for ${project.name}: ` +
      (lastError instanceof Error ? lastError.message : String(lastError)),
  );
}

/** Appends one dated section to the Dream Log. */
export async function appendDream(
  notion: Client,
  dreamLogPageId: string,
  report: DreamReport,
  when: Date,
): Promise<void> {
  const blocks = reportToMarkdown(report, when)
    .split('\n')
    .map(toBlock)
    .filter((b): b is Record<string, unknown> => b !== null);

  // Notion caps children at 100 per append.
  for (let i = 0; i < blocks.length; i += 100) {
    await notion.blocks.children.append({
      block_id: dreamLogPageId,
      children: blocks.slice(i, i + 100) as never,
    });
  }
}

/**
 * Mirrors the latest dream onto the registry row. The server does these
 * property writes via the API — agents never touch the registry (§7).
 */
export async function updateRegistryRow(
  notion: Client,
  schema: RegistrySchema,
  rowId: string,
  report: DreamReport,
  when: Date,
): Promise<void> {
  const properties: Record<string, unknown> = {};

  if (schema.props.status) {
    properties[schema.props.status] = { select: { name: report.health } };
  }
  if (schema.props.lastDream) {
    properties[schema.props.lastDream] = { date: { start: when.toISOString() } };
  }
  if (schema.props.nextStep) {
    const next = report.proposed_next_actions[0]?.title ?? '';
    properties[schema.props.nextStep] = { rich_text: next ? [text(next)] : [] };
  }

  if (Object.keys(properties).length === 0) return;

  await notion.pages.update({ page_id: rowId, properties: properties as never });
}
