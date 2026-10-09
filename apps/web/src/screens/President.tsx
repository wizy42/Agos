import { useCallback, useEffect, useState } from 'react';
import type { Run } from '@cockpit/core';
import { PresidentCard, type StoredPresidentReport } from '../components/PresidentCard.tsx';
import { ago } from '../lib/format.ts';
import { href, navigate } from '../lib/router.ts';

interface PresidentPayload {
  reports: StoredPresidentReport[];
  failures: Run[];
  projects: { id: string; name: string }[];
}

/** Starts a President pass, whole-portfolio or focused on one project, and follows the run. */
function RunPresident({ projects }: { projects: { id: string; name: string }[] }) {
  const [focus, setFocus] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const start = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/president', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ focus: focus || undefined }),
      });
      const body = (await res.json()) as { run?: Run; message?: string; error?: string };
      if (!res.ok) throw new Error(body.message ?? body.error ?? `Server returned ${res.status}`);
      if (body.run) navigate(href.run(body.run.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <select
        value={focus}
        onChange={(e) => setFocus(e.target.value)}
        className="rounded border border-line bg-ink px-2 py-1 text-[12px] text-neutral-300 focus:border-neutral-600 focus:outline-none"
        title="Keep the whole portfolio in view, but weight the pass toward one project"
      >
        <option value="">Whole portfolio</option>
        {projects.map((p) => (
          <option key={p.id} value={p.name}>
            Focus on {p.name}
          </option>
        ))}
      </select>
      <button
        onClick={() => void start()}
        disabled={busy}
        className="rounded border border-line px-2.5 py-1 text-[12px] text-neutral-300 hover:border-neutral-600 hover:text-neutral-100 disabled:opacity-40"
        title="Review the whole portfolio now instead of waiting for Monday"
      >
        {busy ? 'starting…' : 'Run President now'}
      </button>
      {error && <span className="text-[11px] text-rose-300">{error}</span>}
    </div>
  );
}

export function President() {
  const [data, setData] = useState<PresidentPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/president');
      if (!res.ok) throw new Error(`Error ${res.status}`);
      setData((await res.json()) as PresidentPayload);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (error) return <p className="text-sm text-rose-300">{error}</p>;
  if (!data) return <p className="text-sm text-neutral-500">Loading…</p>;

  const [latest, ...earlier] = data.reports;

  return (
    <div className="space-y-8">
      <section>
        <div className="mb-4 flex flex-wrap items-center gap-4">
          <p className="max-w-xl text-[13px] leading-relaxed text-neutral-500">
            Once a week the President reads every project's page, repo, last dream and recent
            sessions, and says where Convergence Labs stands on product, legal, marketing,
            traction, tooling and assets — then ranks the week across projects.
          </p>
          <div className="ml-auto">
            <RunPresident projects={data.projects} />
          </div>
        </div>

        {data.failures.length > 0 && (
          <div className="mb-4 space-y-2">
            {data.failures.slice(0, 3).map((run) => (
              <a
                key={run.id}
                href={href.run(run.id)}
                className="block rounded-lg border border-rose-900/60 bg-rose-950/20 p-3 hover:border-rose-800"
              >
                <div className="flex items-baseline gap-2">
                  <span className="text-[13px] font-medium text-rose-200">President pass failed</span>
                  <span className="text-[11px] text-neutral-600">{ago(run.startedAt)}</span>
                </div>
                <p className="mt-1 font-mono text-[11px] text-rose-300/80">{run.error}</p>
              </a>
            ))}
          </div>
        )}

        {latest ? (
          <PresidentCard item={latest} onChanged={() => void load()} />
        ) : (
          <p className="text-sm text-neutral-600">
            No report yet. The President runs Mondays at 04:00 — or start one now.
          </p>
        )}
      </section>

      {earlier.length > 0 && (
        <section>
          <h2 className="mb-3 flex items-baseline gap-2 text-[11px] font-semibold uppercase tracking-widest text-neutral-500">
            Earlier reports
            <span className="font-normal text-neutral-700">{earlier.length}</span>
          </h2>
          <div className="space-y-3">
            {earlier.map((item) => (
              <PresidentCard key={item.id} item={item} onChanged={() => void load()} compact />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
