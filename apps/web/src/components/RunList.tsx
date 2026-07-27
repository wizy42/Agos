import type { Run, RunStatus } from '@cockpit/core';
import { ago } from '../lib/format.ts';
import { href } from '../lib/router.ts';

const STATUS: Record<RunStatus, string> = {
  running: 'text-sky-300',
  success: 'text-emerald-400',
  error: 'text-rose-400',
  cancelled: 'text-neutral-500',
};

export function RunList({ runs }: { runs: Run[] }) {
  if (runs.length === 0) {
    return <p className="text-sm text-neutral-600">No runs yet.</p>;
  }

  return (
    <div className="divide-y divide-line overflow-hidden rounded-lg border border-line">
      {runs.map((run) => (
        <a
          key={run.id}
          href={href.run(run.id)}
          className="flex items-baseline gap-3 bg-panel px-3 py-2 text-[13px] hover:bg-neutral-900"
        >
          <span className={`w-16 shrink-0 ${STATUS[run.status]}`}>{run.status}</span>
          <span className="w-20 shrink-0 text-neutral-500">{run.permissionProfile}</span>
          <span className="min-w-0 flex-1 truncate text-neutral-300">{run.prompt}</span>
          <span className="w-14 shrink-0 text-right text-neutral-500">
            {run.costUsd != null ? `$${run.costUsd.toFixed(3)}` : '—'}
          </span>
          <span className="w-16 shrink-0 text-right text-neutral-600">{ago(run.startedAt)}</span>
        </a>
      ))}
    </div>
  );
}
