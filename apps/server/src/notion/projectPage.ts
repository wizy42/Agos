import type { Client } from '@notionhq/client';

/**
 * Reads a project's own Notion page for the dream prompt.
 *
 * Without this a dream sees only the repo and the registry row, so it
 * re-litigates decisions the page already settles — the exact thing the
 * portfolio's page template says its DECISION LOG exists to prevent.
 *
 * The template defines fixed, machine-readable sections (`## AGENT_CONTEXT`,
 * `## DECISION LOG`, …), but it is not applied everywhere: some pages predate
 * it and carry an ad-hoc layout. So the preferred sections are used when
 * present and the head of the page otherwise, and an unreadable page degrades
 * to null rather than failing the run.
 */

/** Sections worth their tokens, most valuable first. */
const WANTED: { name: string; match: RegExp }[] = [
  { name: 'AGENT_CONTEXT', match: /AGENT_CONTEXT/i },
  { name: 'DECISION LOG', match: /DECISION\s*LOG/i },
  { name: 'BACKLOG', match: /^#+\s*.*BACKLOG/i },
];

export interface ProjectPageContext {
  /** Text for the prompt, or null when the page could not be read. */
  text: string | null;
  /** Which named sections were found — empty when falling back to the head. */
  sections: string[];
}

type Block = Record<string, any>;

const plain = (rich: unknown): string =>
  Array.isArray(rich) ? rich.map((t: any) => String(t?.plain_text ?? '')).join('') : '';

/** One block as a line of Markdown-ish text, or null when it carries none. */
function lineFor(block: Block): string | null {
  const type = String(block.type ?? '');
  const body = block[type] as Block | undefined;
  if (!body) return null;

  switch (type) {
    case 'heading_1':
      return `# ${plain(body.rich_text)}`;
    case 'heading_2':
      return `## ${plain(body.rich_text)}`;
    case 'heading_3':
      return `### ${plain(body.rich_text)}`;
    case 'bulleted_list_item':
    case 'numbered_list_item':
    case 'to_do':
      return `- ${plain(body.rich_text)}`;
    case 'paragraph':
    case 'quote':
    case 'callout':
    case 'toggle':
      return plain(body.rich_text) || null;
    case 'code':
      return plain(body.rich_text);
    case 'table_row':
      // The template keeps AGENT_CONTEXT as a two-column table, so rows are
      // where Maturity, MRR, Primary Blocker and the GitHub URL actually live.
      return `| ${(body.cells as unknown[][]).map((cell) => plain(cell).trim()).join(' | ')} |`;
    case 'divider':
      return '---';
    default:
      return null;
  }
}

/** Blocks whose children are worth descending into. */
const DESCEND = new Set(['table', 'toggle', 'callout', 'column_list', 'column', 'quote']);

/**
 * Renders a page to lines. Bounded on three axes — depth, total lines, and
 * number of API calls — because a mature project page runs to hundreds of
 * blocks and this happens inside a dream, not a page load.
 */
async function renderPage(
  notion: Client,
  blockId: string,
  budget: { calls: number; lines: number },
  depth = 0,
): Promise<string[]> {
  if (depth > 3 || budget.calls <= 0 || budget.lines <= 0) return [];

  const out: string[] = [];
  let cursor: string | undefined;

  do {
    if (budget.calls-- <= 0) break;

    let res;
    try {
      res = await notion.blocks.children.list({
        block_id: blockId,
        start_cursor: cursor,
        page_size: 100,
      });
    } catch {
      break;
    }

    for (const block of res.results as Block[]) {
      if (budget.lines <= 0) return out;

      // Sub-pages are separate documents; the top-level page summarises them.
      if (block.type === 'child_page' || block.type === 'child_database') continue;

      const line = lineFor(block);
      if (line !== null) {
        out.push(line);
        budget.lines--;
      }

      if (block.has_children && DESCEND.has(String(block.type))) {
        out.push(...(await renderPage(notion, String(block.id), budget, depth + 1)));
      }
    }

    cursor = res.has_more ? (res.next_cursor ?? undefined) : undefined;
  } while (cursor);

  return out;
}

/** The lines under a heading, up to the next heading of the same or higher level. */
function sectionOf(lines: string[], match: RegExp): string[] | null {
  const start = lines.findIndex((l) => /^#{1,3}\s/.test(l) && match.test(l));
  if (start === -1) return null;

  const level = /^(#+)/.exec(lines[start]!)![1]!.length;
  const out = [lines[start]!];

  for (let i = start + 1; i < lines.length; i++) {
    const heading = /^(#+)\s/.exec(lines[i]!);
    if (heading && heading[1]!.length <= level) break;
    out.push(lines[i]!);
  }

  return out;
}

function clamp(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}\n…(truncated)`;
}

export async function readProjectPage(
  notion: Client,
  pageId: string,
  maxChars = 6000,
): Promise<ProjectPageContext> {
  const lines = await renderPage(notion, pageId, { calls: 40, lines: 1200 });
  if (lines.length === 0) return { text: null, sections: [] };

  const found: string[] = [];
  const parts: string[] = [];

  for (const { name, match } of WANTED) {
    const section = sectionOf(lines, match);
    if (section) {
      found.push(name);
      parts.push(section.join('\n'));
    }
  }

  // No templated sections — this page predates the standard. Its opening is
  // still the best summary available, by the template's own top-down rule.
  const text = parts.length > 0 ? parts.join('\n\n') : lines.join('\n');

  return { text: clamp(text.trim(), maxChars) || null, sections: found };
}
