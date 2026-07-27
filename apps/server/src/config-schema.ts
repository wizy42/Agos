/** Shape of the root `cockpit.config.ts`. */

export interface TrackedProject {
  /**
   * Notion page id of the *existing* project page (dashes optional).
   * Matched against the registry row's `Project page` URL.
   */
  notionPageId: string;
  /** Absolute local path to the git repo. `~` is expanded. Overrides the registry's `Repo path`. */
  repoPath: string;
}

export interface CockpitConfig {
  notion: {
    /** The "Convergence Labs Projects" hub page — parent of the registry. */
    hubPageId: string;
    /** The "Cockpit Registry" database created under the hub at M0. */
    registryDatabaseId: string;
  };
  dream: {
    /** node-cron expression, local time. */
    schedule: string;
    /** Max projects dreamed per night, round-robin. */
    maxProjectsPerNight: number;
  };
  librarian: {
    /** node-cron expression, local time. Weekly. */
    schedule: string;
  };
  projects: TrackedProject[];
}
