import { useState } from 'react';
import type { Run } from '@cockpit/core';
import { href, navigate } from '../lib/router.ts';

/**
 * Starts one of the scheduled loops by hand, then follows the run it creates.
 *
 * The server answers as soon as the run exists rather than when the work is
 * finished, so this lands on the live stream instead of freezing for the
 * minutes a dream or a librarian pass actually takes. A job that refuses to
 * start — a dream on a repo that is not on this machine — comes back with the
 * reason, which is shown next to the button rather than swallowed.
 */
export function JobButton({
  url,
  label,
  running = 'starting…',
  title,
  disabled,
  className = '',
}: {
  url: string;
  label: string;
  running?: string;
  title?: string;
  disabled?: boolean;
  className?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const start = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(url, { method: 'POST' });
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
    <span className="inline-flex min-w-0 items-center gap-2">
      <button
        onClick={() => void start()}
        disabled={busy || disabled}
        title={title}
        className={`shrink-0 rounded border border-line px-2 py-0.5 text-[11px] text-neutral-300 hover:border-neutral-600 hover:text-neutral-100 disabled:opacity-40 ${className}`}
      >
        {busy ? running : label}
      </button>
      {error && <span className="truncate text-[11px] text-rose-300">{error}</span>}
    </span>
  );
}
