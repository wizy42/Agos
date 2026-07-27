import { HEALTHS, type DreamReport, type Health, type ProposedAction } from '@cockpit/core';

/**
 * Parses the single JSON block a dream run must end with (§8).
 *
 * A parse failure is a failed run surfaced in the inbox, never a silent drop —
 * so this returns a reason rather than throwing, and the caller records it.
 */

export type ParseResult =
  | { ok: true; report: DreamReport }
  | { ok: false; reason: string };

/** Last fenced ```json block, else the last balanced top-level object. */
function extractJson(text: string): string | null {
  const fences = [...text.matchAll(/```(?:json)?\s*\n([\s\S]*?)```/g)];
  const last = fences.at(-1);
  if (last?.[1]) return last[1].trim();

  // Fall back to the last *top-level* balanced object. A single forward pass
  // keeps nested objects and brace-bearing strings from confusing the scan —
  // starting at the last `{` would land inside proposed_next_actions.
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;
  let found: string | null = null;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;

    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }

    if (ch === '"') inString = true;
    else if (ch === '{') {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === '}') {
      if (depth > 0) {
        depth--;
        if (depth === 0 && start !== -1) found = text.slice(start, i + 1);
      }
    }
  }

  return found;
}

const asStringArray = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];

function asActions(v: unknown): ProposedAction[] {
  if (!Array.isArray(v)) return [];
  return v.flatMap((raw): ProposedAction[] => {
    if (!raw || typeof raw !== 'object') return [];
    const a = raw as Record<string, unknown>;
    if (typeof a.title !== 'string' || typeof a.prompt !== 'string') return [];
    const agent = a.agent === 'observer' ? 'observer' : 'builder';
    return [
      {
        title: a.title,
        why: typeof a.why === 'string' ? a.why : '',
        agent,
        prompt: a.prompt,
      },
    ];
  });
}

export function parseDreamReport(text: string, fallbackProject: string): ParseResult {
  const json = extractJson(text);
  if (!json) {
    return { ok: false, reason: 'The run produced no JSON block.' };
  }

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
      project: typeof obj.project === 'string' && obj.project.trim() ? obj.project : fallbackProject,
      where_we_are: obj.where_we_are,
      what_moved: asStringArray(obj.what_moved),
      risks: asStringArray(obj.risks),
      proposed_next_actions: asActions(obj.proposed_next_actions).slice(0, 3),
      questions_for_ceo: asStringArray(obj.questions_for_ceo),
      health: obj.health as Health,
    },
  };
}

/** The Markdown appended to a project's Dream Log. */
export function reportToMarkdown(report: DreamReport, when: Date): string {
  const lines: string[] = [];
  const list = (items: string[]) =>
    items.length ? items.map((i) => `- ${i}`) : ['- (none)'];

  lines.push(`### ${when.toISOString().slice(0, 10)} — ${report.health}`, '');
  lines.push(report.where_we_are, '');
  lines.push('**What moved**', ...list(report.what_moved), '');
  lines.push('**Risks**', ...list(report.risks), '');

  lines.push('**Proposed next actions**');
  if (report.proposed_next_actions.length === 0) {
    lines.push('- (none)');
  } else {
    for (const a of report.proposed_next_actions) {
      lines.push(`- **${a.title}** (${a.agent}) — ${a.why}`);
    }
  }
  lines.push('');

  lines.push('**Questions for the CEO**', ...list(report.questions_for_ceo));

  return lines.join('\n');
}
