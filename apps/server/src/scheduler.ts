import cron from 'node-cron';
import type { DreamPipeline } from './dream/pipeline.ts';
import type { PortfolioSource } from './app.ts';

/**
 * Nightly dream sweep. Sequential and bounded: never a while-loop, never
 * parallel, capped at `maxProjectsPerNight` (§8, §11).
 */
export function startScheduler(deps: {
  schedule: string;
  maxProjectsPerNight: number;
  portfolio: PortfolioSource;
  pipeline: DreamPipeline;
}): { stop: () => void } {
  const { schedule, maxProjectsPerNight, portfolio, pipeline } = deps;

  if (!cron.validate(schedule)) {
    throw new Error(`Invalid dream schedule "${schedule}" in cockpit.config.ts.`);
  }

  let running = false;

  const task = cron.schedule(schedule, async () => {
    // A sweep that overruns its window must not start a second one.
    if (running) {
      console.warn('[cockpit] previous dream sweep still running; skipping this tick.');
      return;
    }
    running = true;

    try {
      const { projects } = await portfolio.load();
      const outcomes = await pipeline.dreamAll(projects, { max: maxProjectsPerNight });
      for (const o of outcomes) {
        const detail = o.status === 'done' ? o.health : 'reason' in o ? o.reason : '';
        console.log(`[cockpit] dream ${o.project}: ${o.status}${detail ? ` — ${detail}` : ''}`);
      }
    } catch (err) {
      console.error(
        `[cockpit] dream sweep failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      running = false;
    }
  });

  console.log(`[cockpit] dreams scheduled: ${schedule} (max ${maxProjectsPerNight}/night)`);
  return { stop: () => void task.stop() };
}
