import type { PortfolioOrigin, Project } from '@cockpit/core';

export interface PortfolioPayload {
  projects: Project[];
  fetchedAt: string;
  /** `stub` under COCKPIT_STUB=1: sample projects, not the registry. */
  origin: PortfolioOrigin;
  spend7d: { totalUsd: number; runs: number };
  activeRunIds: string[];
}

export async function fetchPortfolio(): Promise<PortfolioPayload> {
  const res = await fetch('/api/portfolio');
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { message?: string } | null;
    throw new Error(body?.message ?? `Server returned ${res.status}`);
  }
  return (await res.json()) as PortfolioPayload;
}
