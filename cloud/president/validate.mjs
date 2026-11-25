#!/usr/bin/env node
// Checks a President report against the contract in prompts/president.md.
// Standalone (no dependencies) so a cloud run can call it without npm install.
//
//   node cloud/president/validate.mjs <file>    # file = the agent's full reply, or just the JSON
//
// Exit 0 and print the normalised JSON on success; exit 1 and print the reasons on failure.
// Stricter than apps/server/src/president/contract.ts on purpose: the local parser
// drops bad entries silently, but a scheduled run has nobody watching, so every
// rule the prompt states is checked and reported.

import { readFileSync } from 'node:fs';

const DIMENSIONS = ['product', 'legal', 'marketing', 'traction', 'tooling', 'assets'];
const HEALTHS = ['green', 'orange', 'red'];
const AGENTS = ['founder', 'builder', 'observer'];

function lastJsonBlock(text) {
  const blocks = [...text.matchAll(/```(?:json)?[^\n]*\n([\s\S]*?)```/g)].map((m) => m[1].trim());
  if (blocks.length) return blocks[blocks.length - 1];
  const t = text.trim();
  return t.startsWith('{') ? t : null;
}

export function validate(text) {
  const errors = [];
  const raw = lastJsonBlock(text);
  if (!raw) return { ok: false, errors: ['no JSON block found'] };
  let r;
  try {
    r = JSON.parse(raw);
  } catch (e) {
    return { ok: false, errors: [`JSON does not parse: ${e.message}`] };
  }
  if (!r || typeof r !== 'object' || Array.isArray(r)) return { ok: false, errors: ['not an object'] };

  if (typeof r.where_we_are !== 'string' || !r.where_we_are.trim()) errors.push('where_we_are missing');
  if (!HEALTHS.includes(r.health)) errors.push(`health must be one of ${HEALTHS.join('/')}`);

  const dims = Array.isArray(r.dimensions) ? r.dimensions : [];
  const names = dims.map((d) => d && d.dimension);
  if (names.join(',') !== DIMENSIONS.join(',')) {
    errors.push(`dimensions must be exactly ${DIMENSIONS.join(', ')} in that order (got ${names.join(', ')})`);
  }
  dims.forEach((d, i) => {
    if (typeof d?.where_we_are !== 'string' || !d.where_we_are.trim()) errors.push(`dimensions[${i}].where_we_are missing`);
    if (!Array.isArray(d?.missing) || d.missing.some((m) => typeof m !== 'string')) errors.push(`dimensions[${i}].missing must be a string array`);
  });

  const pr = Array.isArray(r.priorities) ? r.priorities : null;
  if (!pr) errors.push('priorities must be an array');
  else {
    if (pr.length > 5) errors.push(`at most 5 priorities (got ${pr.length})`);
    pr.forEach((p, i) => {
      for (const k of ['project', 'title', 'why', 'prompt']) {
        if (typeof p?.[k] !== 'string' || !p[k].trim()) errors.push(`priorities[${i}].${k} missing`);
      }
      if (!AGENTS.includes(p?.agent)) errors.push(`priorities[${i}].agent must be one of ${AGENTS.join('/')}`);
    });
  }
  if (!Array.isArray(r.questions_for_ceo) || r.questions_for_ceo.some((q) => typeof q !== 'string')) {
    errors.push('questions_for_ceo must be a string array');
  }
  return errors.length ? { ok: false, errors } : { ok: true, report: r };
}

/** The section appended to the Portfolio Log page — same shape as presidentToMarkdown(). */
export function toMarkdown(r, day) {
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  const out = [`### ${day} — ${r.health}`, '', r.where_we_are, ''];
  for (const d of r.dimensions) {
    out.push(`**${cap(d.dimension)}** — ${d.where_we_are}`, ...d.missing.map((m) => `- ${m}`), '');
  }
  out.push('**Priorities**');
  if (!r.priorities.length) out.push('- (none)');
  r.priorities.forEach((p, i) => {
    out.push(`${i + 1}. **${p.title}** · ${p.project} (${p.agent}) — ${p.why}`, `   > ${p.prompt.replace(/\n/g, ' ')}`);
  });
  out.push('', '**Questions for the CEO**', ...(r.questions_for_ceo.length ? r.questions_for_ceo.map((q) => `- ${q}`) : ['- (none)']));
  return out.join('\n');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const file = process.argv[2];
  if (!file) {
    console.error('usage: node cloud/president/validate.mjs <reply-or-json-file> [--markdown YYYY-MM-DD]');
    process.exit(2);
  }
  const res = validate(readFileSync(file, 'utf8'));
  if (!res.ok) {
    console.error('President contract NOT met:\n- ' + res.errors.join('\n- '));
    process.exit(1);
  }
  const mdAt = process.argv.indexOf('--markdown');
  console.log(mdAt > 0 ? toMarkdown(res.report, process.argv[mdAt + 1]) : JSON.stringify(res.report, null, 2));
}
