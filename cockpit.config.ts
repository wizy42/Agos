import type { CockpitConfig } from './apps/server/src/config-schema.ts';

/**
 * Cockpit configuration.
 *
 * The Cockpit Registry in Notion is the source of truth for tracked projects
 * and their repo paths — `npm run link-repos` fills paths in by matching each
 * project's GitHub URL against the clones on this machine.
 *
 * `projects` is for overrides only: a `repoUrl` for a page that has no
 * Repo & Deploy table yet, or a `repoPath` to pin a clone by hand.
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
      // "🚀 20 — LaunchPad — Operations Layer for Vibe-Coded Apps".
      // Its Notion page predates the template and has no Repo & Deploy table,
      // so the URL lives here until one is added.
      notionPageId: '31e89f2e-f0a3-8152-8027-debe304d8fd1',
      repoUrl: 'https://github.com/wizy42/Launchpad',
    },
  ],
};

export default config;
