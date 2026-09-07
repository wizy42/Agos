import { useEffect, useMemo, useState } from 'react';
import { TIERS, type Tier } from '@cockpit/core';

interface Candidate {
  pageId: string;
  title: string;
  suggestedName: string;
  tier: Tier;
  url: string;
}

interface Registered {
  rowId: string;
  name: string;
  tier: Tier;
  linked: string | null;
  cloneHint: string | null;
}

/**
 * Register a project by picking its page from the hub. The registry row is
 * created in Notion and the repo is matched by git remote on the spot — the
 * same path `link-repos` takes, just for one project.
 */
export function AddProject({ onAdded }: { onAdded: () => void }) {
  const [open, setOpen] = useState(false);
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  const [pageId, setPageId] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<Registered | null>(null);

  useEffect(() => {
    if (!open || candidates) return;
    fetch('/api/hub/candidates')
      .then(async (res) => {
        const body = (await res.json()) as { candidates?: Candidate[]; message?: string };
        if (!res.ok) throw new Error(body.message ?? `Error ${res.status}`);
        setCandidates(body.candidates ?? []);
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, [open, candidates]);

  const selected = useMemo(
    () => candidates?.find((c) => c.pageId === pageId) ?? null,
    [candidates, pageId],
  );

  const byTier = useMemo(() => {
    const groups = new Map<Tier, Candidate[]>();
    for (const tier of TIERS) groups.set(tier, []);
    for (const c of candidates ?? []) groups.get(c.tier)!.push(c);
    return [...groups].filter(([, cs]) => cs.length > 0);
  }, [candidates]);

  const choose = (id: string) => {
    setPageId(id);
    const c = candidates?.find((x) => x.pageId === id);
    setName(c?.suggestedName ?? '');
    setDone(null);
    setError(null);
  };

  const submit = async () => {
    if (!selected || !name.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/registry', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ pageId: selected.pageId, name: name.trim(), tier: selected.tier }),
      });
      const body = (await res.json()) as Registered & { message?: string };
      if (!res.ok) throw new Error(body.message ?? `Error ${res.status}`);
      setDone(body);
      setCandidates((prev) => prev?.filter((c) => c.pageId !== selected.pageId) ?? null);
      setPageId('');
      setName('');
      onAdded();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="rounded border border-line px-2.5 py-1 text-xs text-neutral-400 hover:border-neutral-600 hover:text-neutral-100"
      >
        + Add project
      </button>
    );
  }

  return (
    <div className="rounded-lg border border-line bg-panel p-4">
      <div className="mb-3 flex items-baseline gap-2">
        <h2 className="text-[11px] font-semibold uppercase tracking-widest text-neutral-500">
          Add a project from the hub
        </h2>
        <button
          onClick={() => setOpen(false)}
          className="ml-auto text-[11px] text-neutral-600 hover:text-neutral-300"
        >
          close
        </button>
      </div>

      {error && <p className="mb-3 text-xs text-rose-300">{error}</p>}

      {candidates === null && !error && (
        <p className="text-sm text-neutral-500">Reading the hub…</p>
      )}

      {candidates !== null && candidates.length === 0 && !done && (
        <p className="text-sm text-neutral-500">
          Every project page under the hub is already in the registry.
        </p>
      )}

      {candidates !== null && candidates.length > 0 && (
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex min-w-64 flex-1 flex-col gap-1">
            <span className="text-[10px] uppercase tracking-wide text-neutral-600">Project page</span>
            <select
              value={pageId}
              onChange={(e) => choose(e.target.value)}
              className="rounded border border-line bg-ink px-2 py-1.5 text-[13px] text-neutral-200 focus:border-neutral-600 focus:outline-none"
            >
              <option value="">Pick a page…</option>
              {byTier.map(([tier, cs]) => (
                <optgroup key={tier} label={tier}>
                  {cs.map((c) => (
                    <option key={c.pageId} value={c.pageId}>
                      {c.title}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>

          <label className="flex min-w-48 flex-col gap-1">
            <span className="text-[10px] uppercase tracking-wide text-neutral-600">Registry name</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={!selected}
              placeholder="Name"
              className="rounded border border-line bg-ink px-2 py-1.5 text-[13px] text-neutral-200 placeholder:text-neutral-600 focus:border-neutral-600 focus:outline-none disabled:opacity-40"
            />
          </label>

          {selected && (
            <span className="pb-2 text-[11px] text-neutral-600">{selected.tier}</span>
          )}

          <button
            onClick={() => void submit()}
            disabled={!selected || !name.trim() || busy}
            className="rounded border border-line px-3 py-1.5 text-xs text-neutral-300 hover:border-emerald-800 hover:text-emerald-300 disabled:opacity-40"
          >
            {busy ? 'Adding…' : 'Add to registry'}
          </button>
        </div>
      )}

      {done && (
        <div className="mt-3 rounded border border-emerald-900/60 bg-emerald-950/30 px-3 py-2 text-[12px] text-emerald-200">
          <div>
            <span className="font-medium">{done.name}</span> added under {done.tier}.
          </div>
          {done.linked ? (
            <div className="mt-1 font-mono text-[11px] text-emerald-300/80">repo → {done.linked}</div>
          ) : done.cloneHint ? (
            <div className="mt-1 text-emerald-200/80">
              No clone found on this machine. To bring it in:
              <pre className="mt-1 font-mono text-[11px] text-emerald-300/80">{done.cloneHint}</pre>
            </div>
          ) : (
            <div className="mt-1 text-emerald-200/80">
              No GitHub URL on its page yet — add a Repo &amp; Deploy table, then{' '}
              <code>npm run link-repos</code>.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
