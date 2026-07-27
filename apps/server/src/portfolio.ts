import { Client } from '@notionhq/client';
import type { Project } from '@cockpit/core';
import type { CockpitConfig } from './config-schema.ts';
import { readActivity } from './ingest/activity.ts';
import {
  fetchRegistryRows,
  introspectRegistry,
  normalizeNotionId,
  type RegistrySchema,
} from './notion/registry.ts';

export interface Portfolio {
  projects: Project[];
  fetchedAt: string;
}

/**
 * Joins the Notion registry (durable state) with local git/session activity
 * (a read-only signal). The registry schema is introspected once at boot.
 */
export class PortfolioService {
  private schema: RegistrySchema | null = null;

  constructor(
    private readonly notion: Client,
    private readonly config: CockpitConfig,
  ) {}

  async init(): Promise<RegistrySchema> {
    this.schema = await introspectRegistry(this.notion, this.config.notion.registryDatabaseId);
    return this.schema;
  }

  /** `cockpit.config.ts` repo paths win over the registry's `Repo path`. */
  private repoPathOverride(projectPageUrl: string | null): string | null {
    if (!projectPageUrl) return null;
    const pageId = normalizeNotionId(projectPageUrl);
    if (!pageId) return null;
    const entry = this.config.projects.find((p) => normalizeNotionId(p.notionPageId) === pageId);
    return entry?.repoPath ?? null;
  }

  async load(): Promise<Portfolio> {
    const schema = this.schema ?? (await this.init());
    const rows = await fetchRegistryRows(this.notion, schema);

    const projects = await Promise.all(
      rows.map(async (row): Promise<Project> => {
        const repoPath = this.repoPathOverride(row.projectPageUrl) ?? row.repoPath;
        return {
          ...row,
          repoPath,
          activity: repoPath ? await readActivity(repoPath) : null,
        };
      }),
    );

    return { projects, fetchedAt: new Date().toISOString() };
  }
}
