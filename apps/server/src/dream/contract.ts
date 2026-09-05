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

/** A line that opens or closes a fence: a run of three or more backticks or tildes. */
interface FenceLine {
  line: number;
  char: string;
  info: string;
}

/**
 * Every fence line in the message, each with the index of the bare fence line
 * of the same kind that closes it, if any. Only *lines* count — a fence quoted
 * inside a JSON string sits mid-line, its newline being the two characters
 * `\n` — which is what keeps such a fence from opening or closing anything.
 */
function fenceLines(lines: string[]): { fences: FenceLine[]; closerOf: (number | undefined)[] } {
  const fences: FenceLine[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = /^\s{0,3}(`{3,}|~{3,})(.*)$/.exec(lines[i]!);
    if (m) fences.push({ line: i, char: m[1]![0]!, info: m[2]!.trim().toLowerCase() });
  }

  const closerOf: (number | undefined)[] = new Array<number | undefined>(fences.length);
  const nextBare: Record<string, number | undefined> = {};
  for (let i = fences.length - 1; i >= 0; i--) {
    const f = fences[i]!;
    closerOf[i] = nextBare[f.char];
    if (f.info === '') nextBare[f.char] = i;
  }
  return { fences, closerOf };
}

/**
 * Every complete top-level `{…}` found scanning forward from the start.
 *
 * Two details keep the agent's prose from corrupting the scan. Escapes and
 * strings are tracked so a brace inside a JSON string cannot end an object. But
 * quotes only count *inside* an object: at depth zero a `"` is prose, and
 * treating it as the start of a string is how a lone inch mark, a Windows path,
 * or an unbalanced quotation ends up inverting the string state for everything
 * after it and swallowing the whole report.
 */
function balancedObjects(text: string): string[] {
  const found: string[] = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;

  for (let i = 0; i < text.length; i++) {
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
        if (depth === 0 && start !== -1) found.push(text.slice(start, i + 1));
      }
    }
  }

  return found;
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
 * The JSON payload a run ends with. Shared with the librarian, which uses the
 * same end-with-one-JSON-block shape.
 *
 * The contract is "end with one ```json block", so the report is the *last*
 * such block and nothing else: the last line opening a json-tagged fence, or a
 * later block wrapped in bare fences. Its payload is the first complete object
 * in that block, found by a scan that tracks strings so a fence or brace quoted
 * inside the report cannot end it early. When no complete object is there (the
 * run was cut off, a string was never closed) the raw block is returned so the
 * caller reports the real parse error.
 *
 * What this deliberately does *not* do is look anywhere else once that block
 * exists. Falling back to an earlier block when the last one is malformed would
 * hand back the example the agent showed before its real report; preferring a
 * later bare object would hand back a schema reminder or an aside in the
 * trailing prose. Either is a silent wrong answer, which §8 forbids — a loud
 * failure on the block the agent actually meant is the only safe result.
 *
 * A json-tagged opener counts even with no closer — that is what a cut-off
 * report looks like — and even when a stray fence earlier in the prose left
 * Markdown's pairing out of step. A bare-fenced block only counts when it is
 * properly closed, since an unpaired bare fence is far more often a closer than
 * an opener. Without either, the last fenced block of any kind is taken, and
 * without any fence the whole text is scanned for the last object that parses.
 */
export function extractJsonBlock(text: string): string | null {
  const lines = text.split(/\r?\n/);
  const { fences, closerOf } = fenceLines(lines);
  const body = (i: number): string => {
    const closer = closerOf[i];
    return lines.slice(fences[i]!.line + 1, closer === undefined ? undefined : fences[closer]!.line).join('\n').trim();
  };
  const payload = (block: string): string => balancedObjects(block)[0] ?? block;

  // Markdown pairing: which fence lines open a block, and whether it is closed.
  const paired = new Map<number, boolean>();
  for (let i = 0; i < fences.length; ) {
    const closer = closerOf[i];
    paired.set(i, closer !== undefined);
    i = closer === undefined ? fences.length : closer + 1;
  }

  const isReport = (i: number): boolean =>
    fences[i]!.info.startsWith('json') || (fences[i]!.info === '' && paired.get(i) === true);
  for (let i = fences.length - 1; i >= 0; i--) {
    if (!isReport(i)) continue;
    const block = body(i);
    if (block) return payload(block);
  }

  let last = '';
  for (const i of paired.keys()) last = body(i) || last;
  if (last) return payload(last);

  const bare = balancedObjects(text);
  return bare.findLast(parsesToObject) ?? bare.at(-1) ?? null;
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
