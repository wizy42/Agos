import { useCallback, useEffect, useState } from 'react';
import type { Run, RunEvent } from '@cockpit/core';
import { RunStream } from '../components/RunStream.tsx';
import { ago } from '../lib/format.ts';
import { href } from '../lib/router.ts';
import { useRunStream } from '../lib/ws.ts';

interface RunPayload {
  run: Run;
  events: RunEvent[];
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-neutral-600">{label}</div>
      <div className="text-[13px] text-neutral-300">{value}</div>
    </div>
  );
}

export function RunDetail({ id }: { id: string }) {
  const [data, setData] = useState<RunPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/runs/${id}`);
      if (!res.ok) throw new Error(res.status === 404 ? 'Run not found.' : `Error ${res.status}`);
      setData((await res.json()) as RunPayload);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  // Append live events for this run; refetch on completion to pick up cost.
  useRunStream(
    useCallback(
      (msg) => {
        if (msg.kind === 'run:event' && msg.runId === id) {
          setData((prev) =>
            prev && !prev.events.some((e) => e.seq === msg.event.seq)
              ? { ...prev, events: [...prev.events, msg.event] }
              : prev,
          );
        }
        if (msg.kind === 'run:finished' && msg.runId === id) void load();
      },
      [id, load],
    ),
  );

  const cancel = async () => {
    await fetch(`/api/runs/${id}/cancel`, { method: 'POST' });
    void load();
  };

  if (error) return <p className="text-sm text-rose-300">{error}</p>;
  if (!data) return <p className="text-sm text-neutral-500">Loading…</p>;

  const { run, events } = data;
  const live = run.status === 'running';

  return (
    <div className="space-y-6">
      <div>
        <a
          href={run.projectId ? href.project(run.projectId) : href.portfolio()}
          className="text-xs text-neutral-600 hover:text-neutral-300"
        >
          ← Back
        </a>
        <div className="mt-2 flex items-baseline gap-3">
          <h1 className="text-lg font-semibold text-neutral-100">{run.agentName}</h1>
          <span
            className={`text-xs ${
              live
                ? 'text-sky-300'
                : run.status === 'success'
                  ? 'text-emerald-400'
                  : run.status === 'error'
                    ? 'text-rose-400'
                    : 'text-neutral-500'
            }`}
          >
            {live ? 'running…' : run.status}
          </span>
          {live && (
            <button
              onClick={() => void cancel()}
              className="ml-auto rounded border border-line px-2.5 py-1 text-xs text-neutral-400 hover:border-rose-800 hover:text-rose-300"
            >
              Cancel
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 rounded-lg border border-line bg-panel p-4 sm:grid-cols-5">
        <Stat label="Profile" value={run.permissionProfile} />
        <Stat label="Turns" value={run.numTurns?.toString() ?? '—'} />
        <Stat
          label="Duration"
          value={run.durationMs != null ? `${(run.durationMs / 1000).toFixed(1)}s` : '—'}
        />
        <Stat label="Cost" value={run.costUsd != null ? `$${run.costUsd.toFixed(4)}` : '—'} />
        <Stat label="Started" value={ago(run.startedAt)} />
      </div>

      <section>
        <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-widest text-neutral-500">
          Prompt
        </h2>
        <pre className="whitespace-pre-wrap rounded-lg border border-line bg-panel p-3 font-mono text-[12px] text-neutral-300">
          {run.prompt}
        </pre>
      </section>

      {run.error && (
        <p className="rounded-lg border border-rose-900/60 bg-rose-950/30 p-3 text-xs text-rose-200">
          {run.error}
        </p>
      )}

      <section>
        <h2 className="mb-2 flex items-baseline gap-2 text-[11px] font-semibold uppercase tracking-widest text-neutral-500">
          Stream
          <span className="font-normal normal-case tracking-normal text-neutral-700">
            {events.length} events · replayed from SQLite
          </span>
        </h2>
        <div className="rounded-lg border border-line bg-panel p-4">
          <RunStream events={events} live={live} />
        </div>
      </section>
    </div>
  );
}
