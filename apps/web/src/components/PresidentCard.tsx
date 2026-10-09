import { useState } from 'react';
import type { Health, PresidentReport } from '@cockpit/core';
import { ago } from '../lib/format.ts';
import { href, navigate } from '../lib/router.ts';

export interface StoredPresidentReport {
  id: string;
  runId: string;
  createdAt: string;
  health: string | null;
  report: PresidentReport;
  reviewed: boolean;
}

const DOT: Record<Health, string> = {
  green: 'bg-emerald-400',
  orange: 'bg-amber-400',
  red: 'bg-rose-500',
};

const AGENT_STYLE: Record<string, string> = {
  founder: 'text-amber-300 border-amber-900/60',
  builder: 'text-emerald-300 border-emerald-900/60',
  observer: 'text-sky-300 border-sky-900/60',
};

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * One President report: the company's week on six dimensions, then the
 * ranked cross-project priorities. An agent priority approves into a run on
 * its project; a founder priority is shown as the instruction it is, since no
 * agent can carry it out.
 */
export function PresidentCard({
  item,
  onChanged,
  compact = false,
}: {
  item: StoredPresidentReport;
  onChanged: () => void;
  compact?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(!compact);
  const { report } = item;

  const post = async (path: string, body?: unknown) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
      });
      const data = (await res.json().catch(() => ({}))) as {
        run?: { id: string };
        message?: string;
        error?: string;
      };
      if (!res.ok) throw new Error(data.message ?? data.error ?? `Error ${res.status}`);
      onChanged();
      if (data.run) navigate(href.run(data.run.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <article className="rounded-lg border border-line bg-panel p-4">
      <header className="mb-3 flex items-center gap-2">
        <span
          className={`inline-block size-2.5 rounded-full ${DOT[report.health] ?? 'bg-neutral-600'}`}
        />
        <span className="text-sm font-semibold text-neutral-100">Convergence Labs</span>
        <span className="text-[11px] text-neutral-600">{ago(item.createdAt)}</span>
        {item.reviewed && <span className="text-[10px] uppercase tracking-wide text-neutral-700">reviewed</span>}
        <a
          href={href.run(item.runId)}
          className="ml-auto text-[11px] text-neutral-600 hover:text-neutral-300"
        >
          run ↗
        </a>
        {compact && (
          <button
            onClick={() => setOpen((v) => !v)}
            className="text-[11px] text-neutral-600 hover:text-neutral-300"
          >
            {open ? 'collapse' : 'expand'}
          </button>
        )}
      </header>

      <p className="mb-4 text-[13px] leading-relaxed text-neutral-300">{report.where_we_are}</p>

      {open && (
        <>
          {report.dimensions.length > 0 && (
            <div className="mb-4 grid gap-3 sm:grid-cols-2">
              {report.dimensions.map((d) => (
                <div key={d.dimension} className="rounded border border-line bg-ink p-2.5">
                  <h4 className="mb-1 text-[10px] uppercase tracking-wide text-neutral-500">
                    {capitalize(d.dimension)}
                  </h4>
                  <p className="text-[12px] leading-relaxed text-neutral-300">{d.where_we_are}</p>
                  {d.missing.length > 0 && (
                    <ul className="mt-1.5 space-y-0.5">
                      {d.missing.map((m, i) => (
                        <li key={i} className="text-[12px] text-amber-200/80">
                          <span className="mr-1.5 text-neutral-700">−</span>
                          {m}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </div>
          )}

          {report.priorities.length > 0 && (
            <div className="mb-4">
              <h4 className="mb-2 text-[10px] uppercase tracking-wide text-neutral-600">
                Priorities this week
              </h4>
              <ol className="space-y-2">
                {report.priorities.map((p, i) => (
                  <li key={i} className="rounded border border-line bg-ink p-2.5">
                    <div className="flex items-baseline gap-2">
                      <span className="text-[11px] text-neutral-600">{i + 1}.</span>
                      <span className="text-[13px] font-medium text-neutral-200">{p.title}</span>
                      <span className="text-[11px] text-neutral-500">{p.project}</span>
                      <span
                        className={`rounded border px-1.5 py-0.5 text-[10px] uppercase tracking-wide ${
                          AGENT_STYLE[p.agent] ?? 'text-neutral-400 border-line'
                        }`}
                      >
                        {p.agent}
                      </span>
                      {p.agent !== 'founder' && !item.reviewed && (
                        <button
                          onClick={() => void post(`/api/president/${item.id}/approve`, { index: i })}
                          disabled={busy}
                          className="ml-auto rounded border border-line px-2 py-0.5 text-[11px] text-neutral-300 hover:border-emerald-800 hover:text-emerald-300 disabled:opacity-40"
                        >
                          Approve → run
                        </button>
                      )}
                    </div>
                    {p.why && <p className="mt-1 text-[12px] text-neutral-500">{p.why}</p>}
                    {p.agent === 'founder' && (
                      <p className="mt-1.5 whitespace-pre-wrap text-[12px] leading-relaxed text-amber-100/80">
                        {p.prompt}
                      </p>
                    )}
                  </li>
                ))}
              </ol>
            </div>
          )}

          {report.questions_for_ceo.length > 0 && (
            <div>
              <h4 className="mb-1 text-[10px] uppercase tracking-wide text-neutral-600">
                Questions for the CEO
              </h4>
              <ul className="space-y-1">
                {report.questions_for_ceo.map((q, i) => (
                  <li key={i} className="text-[13px] text-neutral-300">
                    <span className="mr-2 text-neutral-700">·</span>
                    {q}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}

      {!item.reviewed && (
        <footer className="mt-4 flex items-center gap-2 border-t border-line pt-3">
          <button
            onClick={() => void post(`/api/president/${item.id}/dismiss`)}
            disabled={busy}
            className="ml-auto text-[11px] text-neutral-600 hover:text-neutral-300 disabled:opacity-40"
          >
            Mark reviewed
          </button>
        </footer>
      )}

      {error && <p className="mt-2 text-[11px] text-rose-300">{error}</p>}
    </article>
  );
}
