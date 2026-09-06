import { TIERS, type Project, type Tier } from '@cockpit/core';
import { AddProject } from '../components/AddProject.tsx';
import { ProjectCard } from '../components/ProjectCard.tsx';
import { ago } from '../lib/format.ts';

const UNTIERED = 'Untiered' as const;

function group(projects: Project[]): [Tier | typeof UNTIERED, Project[]][] {
  const buckets = new Map<Tier | typeof UNTIERED, Project[]>();
  for (const tier of TIERS) buckets.set(tier, []);
  buckets.set(UNTIERED, []);

  for (const p of projects) buckets.get(p.tier ?? UNTIERED)!.push(p);

  return [...buckets].filter(([, ps]) => ps.length > 0);
}

export function Portfolio({
  projects,
  fetchedAt,
  onChanged,
}: {
  projects: Project[];
  fetchedAt: string;
  /** Called after the registry changed here, so the caller can reload it. */
  onChanged: () => void;
}) {
  if (projects.length === 0) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-neutral-500">
          The Cockpit Registry has no rows yet. Pick a project page from the hub to add the first one.
        </p>
        <AddProject onAdded={onChanged} />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <AddProject onAdded={onChanged} />

      {group(projects).map(([tier, ps]) => (
        <section key={tier}>
          <h2 className="mb-3 flex items-baseline gap-2 text-[11px] font-semibold uppercase tracking-widest text-neutral-500">
            {tier}
            <span className="font-normal text-neutral-700">{ps.length}</span>
          </h2>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {ps.map((p) => (
              <ProjectCard key={p.id} project={p} />
            ))}
          </div>
        </section>
      ))}

      <p className="text-[11px] text-neutral-600">
        Live from the Cockpit Registry · synced {ago(fetchedAt)}
      </p>
    </div>
  );
}
