import type { Project } from '@cockpit/core';

export interface Portfolio {
  projects: Project[];
  fetchedAt: string;
}

export async function fetchPortfolio(): Promise<Portfolio> {
  const res = await fetch('/api/portfolio');
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { message?: string } | null;
    throw new Error(body?.message ?? `Server returned ${res.status}`);
  }
  return (await res.json()) as Portfolio;
}
