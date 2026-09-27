import type { PortfolioSource } from './app.ts';
import { readActivity } from './ingest/activity.ts';
import type { RegistryRow } from './notion/registry.ts';
import type { Portfolio } from './portfolio.ts';

/**
 * A registry that needs no Notion: three fixed rows, served from memory.
 *
 * This is what `COCKPIT_STUB=1` boots against, so the UI can be opened in a
 * sandbox, in CI, or on a laptop where the Notion integration does not exist
 * yet. Only the rows are made up — the activity column is still read from
 * disk, exactly as `PortfolioService` does it, so the card for this repo
 * shows real git state and the one whose clone is missing shows the
 * "repo not found on this machine" state a fresh machine would.
 *
 * Nothing here is written anywhere. The dream loop, the librarian and the
 * project wizard are not started in stub mode; their routes answer 503.
 */

/** Synthetic but well-formed ids: the UI strips the dashes for its URLs. */
const IDS = {
  cockpit: '00000000-0000-4000-8000-000000000001',
  lighthouse: '00000000-0000-4000-8000-000000000002',
  windmill: '00000000-0000-4000-8000-000000000003',
} as const;

/** Same fallback shape the real registry uses for a row without a URL. */
const rowUrl = (id: string): string => `https://notion.so/${id.replace(/-/g, '')}`;

const daysAgo = (days: number): string =>
  new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

/**
 * The sample rows, before local activity is joined in. `repoRoot` is the
 * Cockpit checkout itself, which is the one clone guaranteed to exist
 * wherever this runs.
 */
export function sampleRegistry(repoRoot: string): RegistryRow[] {
  return [
    {
      id: IDS.cockpit,
      name: 'Cockpit',
      projectPageUrl: null,
      registryRowUrl: rowUrl(IDS.cockpit),
      tier: 'SHIP NOW',
      status: 'green',
      repoPath: repoRoot,
      dream: true,
      lastDream: null,
      nextStep: 'Create the Notion integration and run the first dream.',
    },
    {
      id: IDS.lighthouse,
      name: 'Lighthouse',
      projectPageUrl: null,
      registryRowUrl: rowUrl(IDS.lighthouse),
      tier: 'BUILD NEXT',
      status: 'orange',
      // Deliberately a clone that is not on this machine.
      repoPath: '~/code/lighthouse',
      dream: true,
      lastDream: daysAgo(3),
      nextStep: 'Ship the pricing page before the next outreach batch.',
    },
    {
      id: IDS.windmill,
      name: 'Windmill',
      projectPageUrl: null,
      registryRowUrl: rowUrl(IDS.windmill),
      tier: 'STRATEGIC BETS',
      status: null,
      // No repo linked yet — the state a row has before `npm run link-repos`.
      repoPath: null,
      dream: false,
      lastDream: null,
      nextStep: null,
    },
  ];
}

export class StubPortfolio implements PortfolioSource {
  constructor(private readonly repoRoot: string) {}

  async load(): Promise<Portfolio> {
    const projects = await Promise.all(
      sampleRegistry(this.repoRoot).map(async (row) => ({
        ...row,
        activity: row.repoPath ? await readActivity(row.repoPath) : null,
      })),
    );
    return { projects, fetchedAt: new Date().toISOString() };
  }
}
