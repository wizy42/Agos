import { useState } from 'react';
import type { RunChanges } from '@cockpit/core';

/** Lines shown before the diff is folded behind a button. */
const FOLD_AT = 200;

function lineClass(line: string): string {
  if (line.startsWith('diff --git')) return 'mt-3 font-semibold text-neutral-200';
  if (line.startsWith('+++') || line.startsWith('---')) return 'text-neutral-500';
  if (line.startsWith('@@')) return 'text-sky-400';
  if (line.startsWith('+')) return 'bg-emerald-950/40 text-emerald-300';
  if (line.startsWith('-')) return 'bg-rose-950/40 text-rose-300';
  return 'text-neutral-400';
}

/** A unified diff, coloured line by line. No library — the format is stable. */
export function DiffView({ changes }: { changes: RunChanges }) {
  const [expanded, setExpanded] = useState(false);
  const lines = changes.diff.split('\n');
  const folded = !expanded && lines.length > FOLD_AT;
  const shown = folded ? lines.slice(0, FOLD_AT) : lines;
  const empty = changes.diff.trim() === '' && changes.untracked.length === 0;

  return (
    <div className="space-y-3">
      {changes.dirtyBefore && (
        <p className="rounded border border-amber-900/60 bg-amber-950/30 px-3 py-2 text-[12px] text-amber-200">
          The working tree was already dirty before this run, so this diff includes
          changes the agent did not make.
        </p>
      )}

      {empty ? (
        <p className="text-[13px] text-neutral-500">The run left no changes in the working tree.</p>
      ) : (
        <>
          {changes.stat && (
            <pre className="whitespace-pre-wrap font-mono text-[11px] text-neutral-500">
              {changes.stat}
            </pre>
          )}

          {changes.untracked.length > 0 && (
            <div>
              <div className="mb-1 text-[10px] uppercase tracking-wide text-neutral-600">
                New files
              </div>
              <ul className="font-mono text-[12px] text-emerald-300">
                {changes.untracked.map((f) => (
                  <li key={f}>+ {f}</li>
                ))}
              </ul>
            </div>
          )}

          {changes.diff.trim() && (
            <div className="overflow-x-auto rounded border border-line bg-ink">
              <pre className="p-3 font-mono text-[11px] leading-relaxed">
                {shown.map((line, i) => (
                  <div key={i} className={`px-1 ${lineClass(line)}`}>
                    {line || ' '}
                  </div>
                ))}
              </pre>
              {folded && (
                <button
                  onClick={() => setExpanded(true)}
                  className="w-full border-t border-line px-3 py-2 text-left text-[11px] text-neutral-500 hover:text-neutral-200"
                >
                  Show all {lines.length} lines
                </button>
              )}
            </div>
          )}

          {changes.truncated && (
            <p className="text-[11px] text-neutral-600">
              Diff truncated — run <code className="text-neutral-400">git diff</code> in the repo for the rest.
            </p>
          )}
        </>
      )}
    </div>
  );
}
