import { useCallback, useEffect, useState } from 'react';
import type { AgentDef, Run, SkillEntry, SkillProposal } from '@cockpit/core';
import { RunList } from '../components/RunList.tsx';
import { ago } from '../lib/format.ts';

interface AgentsPayload {
  agents: { def: AgentDef; yaml: string }[];
  runs: Run[];
}

interface SkillsPayload {
  installed: SkillEntry[];
  proposals: (SkillProposal & { stagedAt: string })[];
}

function Section({ title, count, children }: { title: string; count?: number; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-3 flex items-baseline gap-2 text-[11px] font-semibold uppercase tracking-widest text-neutral-500">
        {title}
        {count !== undefined && <span className="font-normal text-neutral-700">{count}</span>}
      </h2>
      {children}
    </section>
  );
}

/** Agent YAML, editable in place. The server rejects anything that won't parse. */
function AgentEditor({ name, yaml, onSaved }: { name: string; yaml: string; onSaved: () => void }) {
  const [draft, setDraft] = useState(yaml);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const dirty = draft !== yaml;

  const save = async () => {
    setError(null);
    try {
      const res = await fetch(`/api/agents/${name}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ yaml: draft }),
      });
      const body = (await res.json()) as { message?: string; error?: string };
      if (!res.ok) throw new Error(body.message ?? body.error ?? `Error ${res.status}`);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div className="rounded-lg border border-line bg-panel">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-baseline gap-3 px-3 py-2 text-left"
      >
        <span className="text-[13px] font-medium text-neutral-200">{name}</span>
        <span className="text-[11px] text-neutral-600">
          {dirty ? 'unsaved changes' : 'agents/' + name + '.yaml'}
        </span>
        <span className="ml-auto text-[11px] text-neutral-600">{open ? 'hide' : 'edit'}</span>
      </button>

      {open && (
        <div className="border-t border-line p-3">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={draft.split('\n').length + 1}
            spellCheck={false}
            className="w-full resize-y rounded border border-line bg-ink px-3 py-2 font-mono text-[12px] text-neutral-200 focus:border-neutral-600 focus:outline-none"
          />
          <div className="mt-2 flex items-center gap-2">
            <button
              onClick={() => void save()}
              disabled={!dirty}
              className="rounded border border-line px-2.5 py-1 text-[11px] text-neutral-300 hover:border-neutral-600 hover:text-neutral-100 disabled:opacity-40"
            >
              Save
            </button>
            {dirty && (
              <button
                onClick={() => setDraft(yaml)}
                className="text-[11px] text-neutral-600 hover:text-neutral-300"
              >
                revert
              </button>
            )}
            {saved && <span className="text-[11px] text-emerald-400">saved</span>}
            {error && <span className="text-[11px] text-rose-300">{error}</span>}
          </div>
        </div>
      )}
    </div>
  );
}

const KIND_STYLE: Record<string, string> = {
  new: 'text-emerald-300 border-emerald-900/60',
  rewrite: 'text-sky-300 border-sky-900/60',
  deprecate: 'text-amber-300 border-amber-900/60',
};

function ProposalCard({
  proposal,
  onChanged,
}: {
  proposal: SkillProposal & { stagedAt: string };
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [showBody, setShowBody] = useState(false);

  const act = async (action: 'install' | 'reject') => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/skills/proposals/${proposal.name}/${action}`, {
        method: 'POST',
      });
      const body = (await res.json()) as { message?: string; installedTo?: string; replaced?: boolean };
      if (!res.ok) throw new Error(body.message ?? `Error ${res.status}`);
      if (action === 'install' && body.installedTo) {
        setResult(`${body.replaced ? 'Replaced' : 'Installed'} ${body.installedTo}`);
      }
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <article className="rounded-lg border border-line bg-panel p-3">
      <header className="mb-2 flex items-center gap-2">
        <span
          className={`rounded border px-1.5 py-0.5 text-[10px] uppercase tracking-wide ${
            KIND_STYLE[proposal.kind] ?? 'text-neutral-400 border-line'
          }`}
        >
          {proposal.kind}
        </span>
        <span className="text-[13px] font-medium text-neutral-200">{proposal.name}</span>
        <span className="text-[11px] text-neutral-600">{ago(proposal.stagedAt)}</span>
      </header>

      <p className="mb-2 text-[12px] leading-relaxed text-neutral-400">{proposal.why}</p>

      {proposal.targetPath && (
        <p className="mb-2 font-mono text-[11px] text-neutral-600">{proposal.targetPath}</p>
      )}

      {proposal.diff && (
        <pre className="mb-2 max-h-64 overflow-auto rounded border border-line bg-ink p-2 font-mono text-[11px] text-neutral-400">
          {proposal.diff}
        </pre>
      )}

      {proposal.skillMd && (
        <>
          <button
            onClick={() => setShowBody((v) => !v)}
            className="mb-2 text-[11px] text-neutral-600 hover:text-neutral-300"
          >
            {showBody ? 'hide draft' : 'show draft SKILL.md'}
          </button>
          {showBody && (
            <pre className="mb-2 max-h-80 overflow-auto whitespace-pre-wrap rounded border border-line bg-ink p-2 font-mono text-[11px] text-neutral-300">
              {proposal.skillMd}
            </pre>
          )}
        </>
      )}

      <footer className="flex items-center gap-2 border-t border-line pt-2">
        {proposal.kind !== 'deprecate' && (
          <button
            onClick={() => void act('install')}
            disabled={busy}
            className="rounded border border-line px-2.5 py-1 text-[11px] text-neutral-300 hover:border-emerald-800 hover:text-emerald-300 disabled:opacity-40"
          >
            Install
          </button>
        )}
        <button
          onClick={() => void act('reject')}
          disabled={busy}
          className="text-[11px] text-neutral-600 hover:text-rose-300 disabled:opacity-40"
        >
          Reject
        </button>
        {result && <span className="ml-auto text-[11px] text-emerald-400">{result}</span>}
        {error && <span className="ml-auto text-[11px] text-rose-300">{error}</span>}
      </footer>
    </article>
  );
}

export function Agents() {
  const [agents, setAgents] = useState<AgentsPayload | null>(null);
  const [skills, setSkills] = useState<SkillsPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [a, s] = await Promise.all([fetch('/api/agents'), fetch('/api/skills')]);
      if (!a.ok || !s.ok) throw new Error('Could not load agents or skills.');
      setAgents((await a.json()) as AgentsPayload);
      setSkills((await s.json()) as SkillsPayload);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (error) return <p className="text-sm text-rose-300">{error}</p>;
  if (!agents || !skills) return <p className="text-sm text-neutral-500">Loading…</p>;

  return (
    <div className="space-y-8">
      <Section title="Agents" count={agents.agents.length}>
        {agents.agents.length === 0 ? (
          <p className="text-sm text-neutral-600">No definitions in agents/.</p>
        ) : (
          <div className="space-y-2">
            {agents.agents.map(({ def, yaml }) => (
              <AgentEditor key={def.name} name={def.name} yaml={yaml} onSaved={() => void load()} />
            ))}
          </div>
        )}
      </Section>

      <Section title="Proposals" count={skills.proposals.length}>
        {skills.proposals.length === 0 ? (
          <p className="text-sm text-neutral-600">
            Nothing staged. The librarian runs weekly;{' '}
            <code className="text-neutral-400">pnpm librarian</code> runs it now.
          </p>
        ) : (
          <>
            <p className="mb-3 text-[11px] text-amber-300/80">
              Nothing here is installed. A SKILL.md is instructions your agents will obey — read
              the draft before installing it.
            </p>
            <div className="space-y-3">
              {skills.proposals.map((p) => (
                <ProposalCard key={p.name} proposal={p} onChanged={() => void load()} />
              ))}
            </div>
          </>
        )}
      </Section>

      <Section title="Installed skills" count={skills.installed.length}>
        {skills.installed.length === 0 ? (
          <p className="text-sm text-neutral-600">No skills found.</p>
        ) : (
          <div className="divide-y divide-line overflow-hidden rounded-lg border border-line">
            {skills.installed.map((s) => (
              <div key={s.path} className="flex items-baseline gap-3 bg-panel px-3 py-2 text-[13px]">
                <span className="w-44 shrink-0 truncate text-neutral-200">{s.name}</span>
                <span className="w-20 shrink-0 text-[11px] text-neutral-600">
                  {s.owner ?? s.scope}
                </span>
                <span className="min-w-0 flex-1 truncate text-neutral-500">{s.description}</span>
                <span className="w-16 shrink-0 text-right text-[11px] text-neutral-600">
                  {ago(s.updatedAt)}
                </span>
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section title="Run history" count={agents.runs.length}>
        <RunList runs={agents.runs} />
      </Section>
    </div>
  );
}
