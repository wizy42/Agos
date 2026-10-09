import {
  DIMENSIONS,
  HEALTHS,
  PRIORITY_AGENTS,
  type Dimension,
  type DimensionReview,
  type Health,
  type PresidentReport,
  type Priority,
  type PriorityAgent,
} from '@cockpit/core';
import { extractJsonBlock } from '../dream/contract.ts';

/**
 * Parses the single JSON block a President run must end with. Same posture as
 * the dream contract (§8): a parse failure is a failed run surfaced in the
 * inbox, so this returns a reason rather than throwing.
 */

export type PresidentParse =
  | { ok: true; report: PresidentReport }
  | { ok: false; reason: string };

const MAX_PRIORITIES = 5;

const asStringArray = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];

function asDimensions(v: unknown): DimensionReview[] {
  if (!Array.isArray(v)) return [];
  return v.flatMap((raw): DimensionReview[] => {
    if (!raw || typeof raw !== 'object') return [];
    const d = raw as Record<string, unknown>;
    if (!DIMENSIONS.includes(d.dimension as Dimension)) return [];
    if (typeof d.where_we_are !== 'string') return [];
    return [
      {
        dimension: d.dimension as Dimension,
        where_we_are: d.where_we_are,
        missing: asStringArray(d.missing),
      },
    ];
  });
}

function asPriorities(v: unknown): Priority[] {
  if (!Array.isArray(v)) return [];
  return v.flatMap((raw): Priority[] => {
    if (!raw || typeof raw !== 'object') return [];
    const p = raw as Record<string, unknown>;
    if (typeof p.title !== 'string' || typeof p.prompt !== 'string') return [];
    // An unknown agent name must never become a builder with write access:
    // the founder is the safe default.
    const agent: PriorityAgent = PRIORITY_AGENTS.includes(p.agent as PriorityAgent)
      ? (p.agent as PriorityAgent)
      : 'founder';
    return [
      {
        project: typeof p.project === 'string' && p.project.trim() ? p.project : 'portfolio',
        title: p.title,
        why: typeof p.why === 'string' ? p.why : '',
        agent,
        prompt: p.prompt,
      },
    ];
  });
}

export function parsePresidentReport(text: string): PresidentParse {
  const json = extractJsonBlock(text);
  if (!json) return { ok: false, reason: 'The run produced no JSON block.' };

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (err) {
    return {
      ok: false,
      reason: `The JSON block did not parse: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, reason: 'The JSON block was not an object.' };
  }

  const obj = parsed as Record<string, unknown>;
  if (typeof obj.where_we_are !== 'string' || !obj.where_we_are.trim()) {
    return { ok: false, reason: 'The report is missing "where_we_are".' };
  }
  if (!HEALTHS.includes(obj.health as Health)) {
    return {
      ok: false,
      reason: `"health" must be one of ${HEALTHS.join(', ')} — got ${JSON.stringify(obj.health)}.`,
    };
  }

  return {
    ok: true,
    report: {
      where_we_are: obj.where_we_are,
      dimensions: asDimensions(obj.dimensions),
      priorities: asPriorities(obj.priorities).slice(0, MAX_PRIORITIES),
      questions_for_ceo: asStringArray(obj.questions_for_ceo),
      health: obj.health as Health,
    },
  };
}

const capitalize = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

/** The Markdown appended to the Portfolio Log in Notion. */
export function presidentToMarkdown(report: PresidentReport, when: Date): string {
  const lines: string[] = [];
  const list = (items: string[]) => (items.length ? items.map((i) => `- ${i}`) : ['- (none)']);

  lines.push(`### ${when.toISOString().slice(0, 10)} — ${report.health}`, '');
  lines.push(report.where_we_are, '');

  for (const d of report.dimensions) {
    lines.push(`**${capitalize(d.dimension)}** — ${d.where_we_are}`);
    lines.push(...d.missing.map((m) => `- ${m}`));
    lines.push('');
  }

  lines.push('**Priorities**');
  if (report.priorities.length === 0) {
    lines.push('- (none)');
  } else {
    report.priorities.forEach((p, i) => {
      lines.push(`${i + 1}. **${p.title}** · ${p.project} (${p.agent}) — ${p.why}`);
    });
  }
  lines.push('');

  lines.push('**Questions for the CEO**', ...list(report.questions_for_ceo));
  return lines.join('\n');
}
