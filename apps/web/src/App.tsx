import { useCallback, useEffect, useState } from 'react';
import { fetchPortfolio, type Portfolio as PortfolioData } from './lib/api.ts';
import { Portfolio } from './screens/Portfolio.tsx';

export function App() {
  const [data, setData] = useState<PortfolioData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await fetchPortfolio());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <header className="mb-8 flex items-baseline gap-3 border-b border-line pb-4">
        <h1 className="text-lg font-semibold tracking-tight text-neutral-100">Cockpit</h1>
        <span className="text-xs text-neutral-600">Convergence Labs Agent OS</span>
        <button
          onClick={() => void load()}
          disabled={loading}
          className="ml-auto rounded border border-line px-2.5 py-1 text-xs text-neutral-400 hover:border-neutral-600 hover:text-neutral-100 disabled:opacity-40"
        >
          {loading ? 'Syncing…' : 'Refresh'}
        </button>
      </header>

      {error && (
        <div className="rounded-lg border border-rose-900/60 bg-rose-950/30 p-4 text-sm text-rose-200">
          <p className="font-medium">Could not read the Cockpit Registry.</p>
          <p className="mt-1 font-mono text-xs text-rose-300/80">{error}</p>
        </div>
      )}

      {!error && !data && loading && <p className="text-sm text-neutral-500">Loading portfolio…</p>}

      {!error && data && <Portfolio projects={data.projects} fetchedAt={data.fetchedAt} />}
    </div>
  );
}
