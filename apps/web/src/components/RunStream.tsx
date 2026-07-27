import { useEffect, useRef } from 'react';
import type { RunEvent } from '@cockpit/core';

/**
 * Renders the persisted SDK message stream. The same component serves a live
 * run and a replay — the events are identical either way, which is the point
 * of persisting before broadcasting.
 */

interface Line {
  key: string;
  kind: 'text' | 'tool' | 'result' | 'denied' | 'error' | 'meta';
  label: string;
  body: string;
}

const STYLE: Record<Line['kind'], string> = {
  text: 'text-neutral-200',
  tool: 'text-sky-300',
  result: 'text-emerald-300',
  denied: 'text-amber-300',
  error: 'text-rose-300',
  meta: 'text-neutral-600',
};

function truncate(s: string, n = 400): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

/** Flattens one SDK message into the lines worth showing. */
function linesFor(event: RunEvent): Line[] {
  const p = event.payload as Record<string, any>;
  const base = `${event.seq}`;

  if (event.type === 'assistant') {
    const content = (p?.message?.content ?? []) as Record<string, any>[];
    return content.flatMap((block, i): Line[] => {
      if (block.type === 'text' && block.text?.trim()) {
        return [{ key: `${base}-${i}`, kind: 'text', label: '', body: block.text.trim() }];
      }
      if (block.type === 'tool_use') {
        const input = JSON.stringify(block.input ?? {});
        return [
          { key: `${base}-${i}`, kind: 'tool', label: block.name ?? 'tool', body: truncate(input, 240) },
        ];
      }
      return [];
    });
  }

  if (event.type === 'permission_denied') {
    return [{ key: base, kind: 'denied', label: `denied ${p.tool ?? ''}`, body: String(p.reason ?? '') }];
  }

  if (event.type === 'error') {
    return [{ key: base, kind: 'error', label: 'error', body: String(p.message ?? '') }];
  }

  if (event.type === 'result') {
    const cost = typeof p.total_cost_usd === 'number' ? `$${p.total_cost_usd.toFixed(4)}` : '—';
    const secs = typeof p.duration_ms === 'number' ? `${(p.duration_ms / 1000).toFixed(1)}s` : '—';
    return [
      {
        key: base,
        kind: p.is_error || p.subtype !== 'success' ? 'error' : 'result',
        label: p.subtype ?? 'result',
        body: `${p.num_turns ?? '—'} turns · ${secs} · ${cost}`,
      },
    ];
  }

  if (event.type === 'system' && p?.subtype === 'init') {
    return [{ key: base, kind: 'meta', label: 'init', body: `model ${p.model ?? '—'}` }];
  }

  return [];
}

export function RunStream({ events, live }: { events: RunEvent[]; live: boolean }) {
  const endRef = useRef<HTMLDivElement>(null);
  const lines = events.flatMap(linesFor);

  useEffect(() => {
    if (live) endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [lines.length, live]);

  if (lines.length === 0) {
    return (
      <p className="text-sm text-neutral-600">
        {live ? 'Waiting for the first message…' : 'No renderable messages in this run.'}
      </p>
    );
  }

  return (
    <div className="space-y-2 font-mono text-[12px] leading-relaxed">
      {lines.map((line) => (
        <div key={line.key} className="flex gap-2">
          {line.label && (
            <span className="w-28 shrink-0 truncate text-right text-neutral-600">{line.label}</span>
          )}
          <span className={`min-w-0 whitespace-pre-wrap break-words ${STYLE[line.kind]}`}>
            {line.body}
          </span>
        </div>
      ))}
      <div ref={endRef} />
    </div>
  );
}
