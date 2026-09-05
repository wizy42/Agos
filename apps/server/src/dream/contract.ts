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

/** A possible payload, with the span it covers so the outermost one can win. */
interface Candidate {
  end: number;
  text: string;
}

/** Every ```json fenced block, in document order. */
function fencedBlocks(text: string): Candidate[] {
  return [...text.matchAll(/```(?:json)?\s*\n([\s\S]*?)```/g)].flatMap((m) => {
    const body = m[1]?.trim();
    return body ? [{ end: m.index + m[0].length, text: body }] : [];
  });
}

/**
 * Every complete top-level `{…}` found scanning forward from `from`.
 *
 * Two details keep the agent's prose from corrupting the scan. Escapes and
 * strings are tracked so a brace — or a fence — inside a JSON string cannot end
 * an object. But quotes only count *inside* an object: at depth zero a `"` is
 * prose, and treating it as the start of a string is how a lone inch mark, a
 * Windows path, or an unbalanced quotation ends up inverting the string state
 * for everything after it and swallowing the whole report.
 */
function balancedObjects(text: string, from: number): Candidate[] {
  const found: Candidate[] = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;

  for (let i = from; i < text.length; i++) {
    const ch = text[i]!;

    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }

    if (ch === '"') {
      if (depth > 0) inString = true;
    } else if (ch === '{') {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === '}') {
      if (depth > 0) {
        depth--;
        if (depth === 0 && start !== -1) found.push({ end: i + 1, text: text.slice(start, i + 1) });
      }
    }
  }

  return found;
}

/**
 * Just past each fence opener, latest first and capped.
 *
 * A single scan of the whole message is not enough: one unclosed `{` in the
 * prose — "set {sessionId in the hook" — leaves the depth counter stuck above
 * zero, so no later object ever completes. Restarting from a fence sidesteps
 * whatever came before it.
 */
function fenceStarts(text: string): number[] {
  return [...text.matchAll(/```[^\n`]*\n/g)].map((m) => m.index + m[0].length).slice(-16);
}

function parsesToObject(candidate: string): boolean {
  try {
    const value: unknown = JSON.parse(candidate);
    return !!value && typeof value === 'object' && !Array.isArray(value);
  } catch {
    return false;
  }
}

/**
 * The JSON payload a run ends with — the latest candidate that actually parses.
 * Shared with the librarian, which uses the same end-with-one-JSON-block shape.
 *
 * Matching the fence with a regex is not enough on its own. Agents routinely
 * put a fence *inside* a JSON string — a librarian staging a SKILL.md draft
 * that shows an example block, a dream quoting code in an action prompt — and a
 * non-greedy ```…``` match ends the block at that inner fence, mid-string. The
 * whole run then fails on an "Unterminated string" that has nothing to do with
 * what the agent wrote. The balanced scan does not have that problem: it tracks
 * quotes, so a fence inside a string is just three characters.
 *
 * Candidates are ordered by where they *end* and tried last-first. Ending last
 * is what picks the real report over an example shown before it, and — unlike
 * ordering by where a candidate starts — it also prefers an enclosing object to
 * any smaller one a rescan happens to find inside its strings. Requiring a
 * candidate to parse is what lets trailing prose containing braces be skipped.
 */
export function extractJsonBlock(text: string): string | null {
  const candidates = [
    ...balancedObjects(text, 0),
    ...fenceStarts(text).flatMap((from) => balancedObjects(text, from)),
    ...fencedBlocks(text),
  ].sort((a, b) => a.end - b.end);

  for (let i = candidates.length - 1; i >= 0; i--) {
    const candidate = candidates[i]!.text;
    if (parsesToObject(candidate)) return candidate;
  }

  // Nothing parsed. Hand back the last candidate anyway so the caller can say
  // *why* the run failed — a bad reason still beats a silent drop (§8).
  return candidates.at(-1)?.text ?? null;
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
  const json = extractJsonBlock(text);
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
