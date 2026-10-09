import cron from 'node-cron';
import type { DreamPipeline } from './dream/pipeline.ts';
import type { President } from './president/pipeline.ts';
import type { Librarian } from './skills/librarian.ts';
import type { PortfolioSource } from './app.ts';

/**
 * One scheduled loop: validated expression, and a tick that overruns its
 * window must not start a second one. Sequential and bounded — never a
 * while-loop, never parallel (§11).
 */
function guardedCron(
  name: string,
  schedule: string,
  tick: () => Promise<void>,
): { stop: () => void } {
  if (!cron.validate(schedule)) {
    throw new Error(`Invalid ${name} schedule "${schedule}" in cockpit.config.ts.`);
  }

  let running = false;
  const task = cron.schedule(schedule, async () => {
    if (running) {
      console.warn(`[cockpit] previous ${name} pass still running; skipping this tick.`);
      return;
    }
    running = true;
    try {
      await tick();
    } catch (err) {
      console.error(`[cockpit] ${name} pass failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      running = false;
    }
  });

  return { stop: () => void task.stop() };
}

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

  const task = guardedCron('dream', schedule, async () => {
    const { projects } = await portfolio.load();
    const outcomes = await pipeline.dreamAll(projects, { max: maxProjectsPerNight });
    for (const o of outcomes) {
      const detail = o.status === 'done' ? o.health : 'reason' in o ? o.reason : '';
      console.log(`[cockpit] dream ${o.project}: ${o.status}${detail ? ` — ${detail}` : ''}`);
    }
  });

  console.log(`[cockpit] dreams scheduled: ${schedule} (max ${maxProjectsPerNight}/night)`);
  return task;
}

/** Weekly skill librarian. Output is staged for review, never installed (§9). */
export function startLibrarian(deps: {
  schedule: string;
  portfolio: PortfolioSource;
  librarian: Librarian;
}): { stop: () => void } {
  const { schedule, portfolio, librarian } = deps;

  const task = guardedCron('librarian', schedule, async () => {
    const { projects } = await portfolio.load();
    const outcome = await librarian.run(projects);
    if (outcome.status === 'done') {
      console.log(
        `[cockpit] librarian: ${outcome.staged.length} proposal(s) staged in skills-proposed/`,
      );
    } else {
      console.error(`[cockpit] librarian failed: ${outcome.reason}`);
    }
  });

  console.log(`[cockpit] librarian scheduled: ${schedule}`);
  return task;
}

/** Weekly President pass over the whole portfolio. Output lands in Notion and the inbox. */
export function startPresident(deps: {
  schedule: string;
  portfolio: PortfolioSource;
  president: President;
}): { stop: () => void } {
  const { schedule, portfolio, president } = deps;

  const task = guardedCron('president', schedule, async () => {
    const { projects } = await portfolio.load();
    const outcome = await president.run(projects);
    if (outcome.status === 'done') {
      console.log(`[cockpit] president: ${outcome.health} — report in the inbox and the Portfolio Log`);
    } else {
      console.error(`[cockpit] president failed: ${outcome.reason}`);
    }
  });

  console.log(`[cockpit] president scheduled: ${schedule}`);
  return task;
}
