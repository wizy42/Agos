import { useCallback, useEffect, useState } from 'react';
import type { PermissionProfile, Project as ProjectT, Run } from '@cockpit/core';
import { RunList } from '../components/RunList.tsx';
import { ago } from '../lib/format.ts';
import { href, navigate } from '../lib/router.ts';
import { useRunStream } from '../lib/ws.ts';

interface ProjectPayload {
  project: ProjectT;
  runs: Run[];
}

const PROFILES: { value: PermissionProfile; label: string; hint: string }[] = [
  { value: 'observer', label: 'observer', hint: 'Read-only. No edits, no mutating shell.' },
  { value: 'builder', label: 'builder', hint: 'Can edit files, confined to the repo.' },
];

/** Prompt box → a streamed run on this repo. */
function Launcher({ project, onLaunched }: { project: ProjectT; onLaunched: () => void }) {
  const [prompt, setPrompt] = useState('');
  const [profile, setProfile] = useState<PermissionProfile>('observer');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const launch = async () => {
    if (!prompt.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/runs', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ projectId: project.id, permissionProfile: profile, prompt }),
      });
      const body = (await res.json()) as { run?: Run; message?: string; error?: string };
      if (!res.ok) throw new Error(body.message ?? body.error ?? `Server returned ${res.status}`);
      setPrompt('');
      onLaunched();
      if (body.run) navigate(href.run(body.run.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const active = PROFILES.find((p) => p.value === profile)!;

  return (
    <div className="rounded-lg border border-line bg-panel p-4">
      <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-widest text-neutral-500">
        Talk to this project
      </h2>

      <textarea
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void launch();
        }}
        rows={3}
        placeholder="What should this agent look at? (⌘↵ to run)"
        className="w-full resize-y rounded border border-line bg-ink px-3 py-2 text-[13px] text-neutral-200 placeholder:text-neutral-600 focus:border-neutral-600 focus:outline-none"
      />

      <div className="mt-3 flex items-center gap-2">
        <div className="flex overflow-hidden rounded border border-line">
          {PROFILES.map((p) => (
            <button
              key={p.value}
              onClick={() => setProfile(p.value)}
              className={`px-2.5 py-1 text-xs ${
                profile === p.value
                  ? 'bg-neutral-800 text-neutral-100'
                  : 'text-neutral-500 hover:text-neutral-300'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>

        <span className="text-[11px] text-neutral-600">{active.hint}</span>

        <button
          onClick={() => void launch()}
          disabled={busy || !prompt.trim()}
          className="ml-auto rounded border border-line px-3 py-1 text-xs text-neutral-300 hover:border-neutral-600 hover:text-neutral-100 disabled:opacity-40"
        >
          {busy ? 'Starting…' : 'Run'}
        </button>
      </div>

      {error && <p className="mt-2 text-xs text-rose-300">{error}</p>}
    </div>
  );
}

export function Project({ id }: { id: string }) {
  const [data, setData] = useState<ProjectPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/projects/${id}`);
      if (!res.ok) throw new Error(res.status === 404 ? 'Project not found.' : `Error ${res.status}`);
      setData((await res.json()) as ProjectPayload);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  // Refresh the timeline whenever a run on this project starts or ends.
  useRunStream((msg) => {
    if (msg.kind === 'run:started' || msg.kind === 'run:finished') void load();
  });

  if (error) return <p className="text-sm text-rose-300">{error}</p>;
  if (!data) return <p className="text-sm text-neutral-500">Loading…</p>;

  const { project, runs } = data;
  const a = project.activity;

  return (
    <div className="space-y-6">
      <div>
        <a href={href.portfolio()} className="text-xs text-neutral-600 hover:text-neutral-300">
          ← Portfolio
        </a>
        <div className="mt-2 flex items-baseline gap-3">
          <h1 className="text-lg font-semibold text-neutral-100">{project.name}</h1>
          <span className="text-xs text-neutral-600">{project.tier ?? 'untiered'}</span>
          {project.projectPageUrl && (
            <a
              href={project.projectPageUrl}
              target="_blank"
              rel="noreferrer"
              className="ml-auto text-xs text-neutral-400 hover:text-neutral-100"
            >
              Notion page ↗
            </a>
          )}
        </div>
        <p className="mt-1 font-mono text-[11px] text-neutral-600">
          {project.repoPath ?? 'no repo path'}
          {a?.repoFound === false && ' · not found on this machine'}
          {a?.branch && ` · ${a.branch}`}
          {a?.dirty && ' · dirty'}
          {a?.lastCommitAt && ` · last commit ${ago(a.lastCommitAt)}`}
        </p>
      </div>

      <Launcher project={project} onLaunched={() => void load()} />

      <section>
        <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-widest text-neutral-500">
          Timeline
        </h2>
        <RunList runs={runs} />
      </section>
    </div>
  );
}
