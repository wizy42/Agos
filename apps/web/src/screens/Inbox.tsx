import { useCallback, useEffect, useState } from 'react';
import type { DreamReport, Health, Run } from '@cockpit/core';
import { ago } from '../lib/format.ts';
import { href, navigate } from '../lib/router.ts';

interface InboxItem {
  id: string;
  runId: string;
  projectId: string;
  projectName: string;
  createdAt: string;
  health: string | null;
  report: DreamReport;
}

interface InboxPayload {
  reports: InboxItem[];
  failures: { run: Run; projectName: string }[];
}

const DOT: Record<Health, string> = {
  green: 'bg-emerald-400',
  orange: 'bg-amber-400',
  red: 'bg-rose-500',
};

function Bullets({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div>
      <h4 className="mb-1 text-[10px] uppercase tracking-wide text-neutral-600">{title}</h4>
      <ul className="space-y-1">
        {items.map((item, i) => (
          <li key={i} className="text-[13px] text-neutral-300">
            <span className="mr-2 text-neutral-700">·</span>
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}

function ReportCard({ item, onChanged }: { item: InboxItem; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [question, setQuestion] = useState('');
  const [asking, setAsking] = useState(false);

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
        run?: Run;
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

  const { report } = item;

  return (
    <article className="rounded-lg border border-line bg-panel p-4">
      <header className="mb-3 flex items-center gap-2">
        <span
          className={`inline-block size-2.5 rounded-full ${DOT[report.health] ?? 'bg-neutral-600'}`}
        />
        <a
          href={href.project(item.projectId)}
          className="text-sm font-semibold text-neutral-100 hover:underline"
        >
          {item.projectName}
        </a>
        <span className="text-[11px] text-neutral-600">{ago(item.createdAt)}</span>
        <a
          href={href.run(item.runId)}
          className="ml-auto text-[11px] text-neutral-600 hover:text-neutral-300"
        >
          run ↗
        </a>
      </header>

      <p className="mb-4 text-[13px] leading-relaxed text-neutral-300">{report.where_we_are}</p>

      <div className="mb-4 space-y-3">
        <Bullets title="What moved" items={report.what_moved} />
        <Bullets title="Risks" items={report.risks} />
      </div>

      {report.proposed_next_actions.length > 0 && (
        <div className="mb-4">
          <h4 className="mb-2 text-[10px] uppercase tracking-wide text-neutral-600">
            Proposed next actions
          </h4>
          <div className="space-y-2">
            {report.proposed_next_actions.map((action, i) => (
              <div key={i} className="rounded border border-line bg-ink p-2.5">
                <div className="flex items-baseline gap-2">
                  <span className="text-[13px] font-medium text-neutral-200">{action.title}</span>
                  <span className="text-[10px] uppercase tracking-wide text-neutral-600">
                    {action.agent}
                  </span>
                  <button
                    onClick={() => void post(`/api/inbox/${item.id}/approve`, { actionIndex: i })}
                    disabled={busy}
                    className="ml-auto rounded border border-line px-2 py-0.5 text-[11px] text-neutral-300 hover:border-emerald-800 hover:text-emerald-300 disabled:opacity-40"
                  >
                    Approve → run
                  </button>
                </div>
                {action.why && <p className="mt-1 text-[12px] text-neutral-500">{action.why}</p>}
              </div>
            ))}
          </div>
        </div>
      )}

      <Bullets title="Questions for the CEO" items={report.questions_for_ceo} />

      <footer className="mt-4 flex items-center gap-2 border-t border-line pt-3">
        {asking ? (
          <>
            <input
              autoFocus
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && question.trim()) {
                  void post(`/api/inbox/${item.id}/approve`, {
                    mode: 'follow-up',
                    question,
                  });
                }
                if (e.key === 'Escape') setAsking(false);
              }}
              placeholder="Ask this project a follow-up… (↵ to run)"
              className="flex-1 rounded border border-line bg-ink px-2 py-1 text-[12px] text-neutral-200 placeholder:text-neutral-600 focus:border-neutral-600 focus:outline-none"
            />
            <button
              onClick={() => setAsking(false)}
              className="text-[11px] text-neutral-600 hover:text-neutral-300"
            >
              cancel
            </button>
          </>
        ) : (
          <>
            <button
              onClick={() => setAsking(true)}
              disabled={busy}
              className="rounded border border-line px-2.5 py-1 text-[11px] text-neutral-400 hover:border-neutral-600 hover:text-neutral-100 disabled:opacity-40"
            >
              Ask follow-up
            </button>
            <button
              onClick={() => void post(`/api/inbox/${item.id}/dismiss`)}
              disabled={busy}
              className="ml-auto text-[11px] text-neutral-600 hover:text-neutral-300 disabled:opacity-40"
            >
              Dismiss
            </button>
          </>
        )}
      </footer>

      {error && <p className="mt-2 text-[11px] text-rose-300">{error}</p>}
    </article>
  );
}

export function Inbox() {
  const [data, setData] = useState<InboxPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/inbox');
      if (!res.ok) throw new Error(`Error ${res.status}`);
      setData((await res.json()) as InboxPayload);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (error) return <p className="text-sm text-rose-300">{error}</p>;
  if (!data) return <p className="text-sm text-neutral-500">Loading inbox…</p>;

  const empty = data.reports.length === 0 && data.failures.length === 0;

  return (
    <div className="space-y-6">
      {empty && (
        <p className="text-sm text-neutral-500">
          Nothing to review. Dreams run nightly; <code className="text-neutral-400">pnpm dream
          --project X --force</code> produces one now.
        </p>
      )}

      {data.failures.length > 0 && (
        <section>
          <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-widest text-rose-400">
            Failed dreams
          </h2>
          <div className="space-y-2">
            {data.failures.map(({ run, projectName }) => (
              <a
                key={run.id}
                href={href.run(run.id)}
                className="block rounded-lg border border-rose-900/60 bg-rose-950/20 p-3 hover:border-rose-800"
              >
                <div className="flex items-baseline gap-2">
                  <span className="text-[13px] font-medium text-rose-200">{projectName}</span>
                  <span className="text-[11px] text-neutral-600">{ago(run.startedAt)}</span>
                </div>
                <p className="mt-1 font-mono text-[11px] text-rose-300/80">{run.error}</p>
              </a>
            ))}
          </div>
        </section>
      )}

      {data.reports.length > 0 && (
        <section>
          <h2 className="mb-3 flex items-baseline gap-2 text-[11px] font-semibold uppercase tracking-widest text-neutral-500">
            Unreviewed dreams
            <span className="font-normal text-neutral-700">{data.reports.length}</span>
          </h2>
          <div className="space-y-3">
            {data.reports.map((item) => (
              <ReportCard key={item.id} item={item} onChanged={() => void load()} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
