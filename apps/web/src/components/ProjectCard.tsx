import type { Health, Project } from '@cockpit/core';
import { ago } from '../lib/format.ts';
import { href } from '../lib/router.ts';

const DOT: Record<Health, string> = {
  green: 'bg-emerald-400',
  orange: 'bg-amber-400',
  red: 'bg-rose-500',
};

function StatusDot({ status }: { status: Health | null }) {
  const cls = status ? DOT[status] : 'bg-neutral-600';
  return (
    <span
      className={`inline-block size-2.5 shrink-0 rounded-full ${cls}`}
      title={status ?? 'no status yet'}
    />
  );
}

function Field({ label, value, dim }: { label: string; value: string; dim?: boolean }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="w-20 shrink-0 text-[11px] uppercase tracking-wide text-neutral-500">
        {label}
      </span>
      <span className={`truncate text-[13px] ${dim ? 'text-neutral-500' : 'text-neutral-300'}`}>
        {value}
      </span>
    </div>
  );
}

export function ProjectCard({ project }: { project: Project }) {
  const a = project.activity;

  // Last activity = the most recent of git commit and Claude session mtime.
  const lastActivity = [a?.lastCommitAt, a?.lastSessionAt]
    .filter((v): v is string => Boolean(v))
    .sort()
    .at(-1);

  let activityText: string;
  if (!project.repoPath) activityText = 'no repo path';
  else if (!a?.repoFound) activityText = 'repo not found on this machine';
  else if (!lastActivity) activityText = 'no commits or sessions';
  else activityText = `${ago(lastActivity)}${a.dirty ? ' · dirty' : ''}`;

  return (
    <div className="rounded-lg border border-line bg-panel p-4 transition-colors hover:border-neutral-600">
      <div className="mb-3 flex items-center gap-2">
        <StatusDot status={project.status} />
        <a
          href={href.project(project.id)}
          className="truncate text-sm font-semibold text-neutral-100 hover:underline"
        >
          {project.name}
        </a>
        {project.dream && (
          <span
            className="ml-auto shrink-0 rounded border border-line px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-neutral-400"
            title="Included in the nightly dream loop"
          >
            dream
          </span>
        )}
      </div>

      <div className="space-y-1.5">
        <Field label="Activity" value={activityText} dim={!lastActivity} />
        <Field
          label="Dream age"
          value={project.lastDream ? ago(project.lastDream) : 'never dreamed'}
          dim={!project.lastDream}
        />
        <Field
          label="Next step"
          value={project.nextStep ?? '—'}
          dim={!project.nextStep}
        />
      </div>

      <div className="mt-3 flex items-center gap-3 border-t border-line pt-2.5 text-[11px]">
        {project.projectPageUrl && (
          <a
            href={project.projectPageUrl}
            target="_blank"
            rel="noreferrer"
            className="text-neutral-400 hover:text-neutral-100"
          >
            Notion page ↗
          </a>
        )}
        <a
          href={project.registryRowUrl}
          target="_blank"
          rel="noreferrer"
          className="text-neutral-500 hover:text-neutral-100"
        >
          registry row ↗
        </a>
        {project.repoPath && (
          <span className="ml-auto truncate font-mono text-neutral-600" title={project.repoPath}>
            {project.repoPath}
          </span>
        )}
      </div>
    </div>
  );
}
