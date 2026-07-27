import type { CockpitConfig } from './apps/server/src/config-schema.ts';

/**
 * Cockpit configuration.
 *
 * `projects` maps each tracked Notion project page to its local git repo.
 * The registry row's `Repo path` property is the fallback when a project is
 * not listed here; an entry here wins.
 */
const config: CockpitConfig = {
  notion: {
    // "Convergence Labs Projects"
    hubPageId: '31489f2e-f0a3-806e-a28b-e3212e2e4cba',
    // "Cockpit Registry", created under the hub at M0.
    registryDatabaseId: '47076143-664f-402c-8c4c-8571d399de7c',
  },

  dream: {
    // 02:00 every night.
    schedule: '0 2 * * *',
    maxProjectsPerNight: 3,
  },

  librarian: {
    // Weekly, Monday 03:00 — after the night's dreams have landed.
    schedule: '0 3 * * 1',
  },

  projects: [
    {
      // "🚀 20 — LaunchPad — Operations Layer for Vibe-Coded Apps"
      notionPageId: '31e89f2e-f0a3-8152-8027-debe304d8fd1',
      repoPath: '~/dev/launchpad',
    },
  ],
};

export default config;
