/** Compact relative age: "3h", "2d", "—". Dense over pretty. */
export function age(iso: string | null | undefined): string {
  if (!iso) return '—';
  const ms = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(ms)) return '—';
  if (ms < 0) return 'now';

  const min = Math.floor(ms / 60_000);
  if (min < 1) return 'now';
  if (min < 60) return `${min}m`;

  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;

  const d = Math.floor(hr / 24);
  if (d < 60) return `${d}d`;

  return `${Math.floor(d / 30)}mo`;
}

/** `age` phrased as an elapsed duration: "3h ago", "just now". */
export function ago(iso: string | null | undefined): string {
  const a = age(iso);
  if (a === '—') return '—';
  return a === 'now' ? 'just now' : `${a} ago`;
}
