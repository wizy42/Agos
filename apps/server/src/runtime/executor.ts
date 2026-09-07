import { randomUUID } from 'node:crypto';
import { query, type Options, type SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import type { PermissionProfile, Run } from '@cockpit/core';
import type { Bus } from '../bus.ts';
import type { Store } from '../db.ts';
import { expandPath } from '../ingest/activity.ts';
import { changesBetween, snapshotRepo } from '../ingest/snapshot.ts';
import { decide, specFor } from './profiles.ts';

export interface LaunchRequest {
  agentName: string;
  projectId: string | null;
  repoPath: string;
  permissionProfile: PermissionProfile;
  prompt: string;
  model?: string;
  maxTurns?: number;
}

/**
 * Runs agents through the Agent SDK's `query()` — never by pty-wrapping the
 * interactive CLI. Every SDK message is persisted before it is broadcast, so a
 * run detail screen replays identically whether the run is live or long over.
 *
 * Global concurrency is 1 by default (§11): runs queue rather than overlap, so
 * a nightly dream cannot collide with a builder run the CEO just approved.
 */
export class Executor {
  private queue: Promise<unknown> = Promise.resolve();
  private readonly active = new Map<string, AbortController>();
  private readonly waiters = new Map<string, ((run: Run) => void)[]>();

  constructor(
    private readonly store: Store,
    private readonly bus: Bus,
  ) {}

  get activeRunIds(): string[] {
    return [...this.active.keys()];
  }

  /** Registers the run, queues execution, and returns immediately. */
  launch(req: LaunchRequest): Run {
    const id = randomUUID();
    const cwd = expandPath(req.repoPath);

    this.store.createRun({
      id,
      agentName: req.agentName,
      projectId: req.projectId,
      cwd,
      permissionProfile: req.permissionProfile,
      prompt: req.prompt,
      startedAt: new Date().toISOString(),
    });

    this.queue = this.queue.then(() => this.execute(id, cwd, req).catch(() => undefined));

    this.bus.broadcast({
      kind: 'run:started',
      runId: id,
      projectId: req.projectId,
      agentName: req.agentName,
    });

    return this.store.getRun(id)!;
  }

  /**
   * Resolves when the run leaves `running`. Used by the dream pipeline, which
   * must parse the report before moving to the next project.
   */
  whenFinished(runId: string): Promise<Run> {
    const run = this.store.getRun(runId);
    if (!run) return Promise.reject(new Error(`Unknown run ${runId}`));
    if (run.status !== 'running') return Promise.resolve(run);

    return new Promise<Run>((res) => {
      const list = this.waiters.get(runId) ?? [];
      list.push(res);
      this.waiters.set(runId, list);
    });
  }

  cancel(runId: string): boolean {
    const controller = this.active.get(runId);
    if (!controller) return false;
    controller.abort();
    return true;
  }

  private record(runId: string, seq: number, type: string, payload: unknown): void {
    const event = this.store.appendEvent(runId, seq, type, payload);
    this.bus.broadcast({ kind: 'run:event', runId, event });
  }

  private async execute(runId: string, cwd: string, req: LaunchRequest): Promise<void> {
    const spec = specFor(req.permissionProfile);
    const controller = new AbortController();
    this.active.set(runId, controller);

    let seq = 0;
    let sessionId: string | null = null;

    const options: Options = {
      cwd,
      model: req.model,
      maxTurns: req.maxTurns ?? 25,
      allowedTools: spec.allowedTools,
      disallowedTools: spec.disallowedTools,
      permissionMode: spec.permissionMode,
      abortController: controller,

      /**
       * The gate. A PreToolUse hook fires for *every* tool call, including ones
       * the SDK's own classifier would auto-approve without prompting — which
       * `canUseTool` alone never sees. That difference is load-bearing: without
       * it an observer could shell out to any command the classifier considers
       * read-only, `ls` and `cat` included, not just the git subset we allow.
       */
      hooks: {
        PreToolUse: [
          {
            hooks: [
              async (input) => {
                const { tool_name: toolName, tool_input: toolInput } = input as {
                  tool_name: string;
                  tool_input: Record<string, unknown>;
                };
                const decision = decide(req.permissionProfile, cwd, toolName, toolInput ?? {});
                if (decision.behavior === 'deny') {
                  this.record(runId, seq++, 'permission_denied', {
                    tool: toolName,
                    reason: decision.message,
                  });
                  return {
                    hookSpecificOutput: {
                      hookEventName: 'PreToolUse' as const,
                      permissionDecision: 'deny' as const,
                      permissionDecisionReason: decision.message ?? 'Denied by profile.',
                    },
                  };
                }
                return { continue: true };
              },
            ],
          },
        ],
      },

      /**
       * Second layer, for anything that still reaches an interactive prompt.
       *
       * The SDK logs CLAUDE_SDK_CAN_USE_TOOL_SHADOWED here, because bare
       * `allowedTools` entries auto-approve before this callback is consulted.
       * That warning is expected and not a hole: the PreToolUse hook above is
       * the actual gate and fires for every tool, bare-listed ones included
       * (verified — a builder Read of /etc/passwd is denied by the hook).
       */
      canUseTool: async (toolName, input) => {
        const decision = decide(req.permissionProfile, cwd, toolName, input);
        if (decision.behavior === 'deny') {
          this.record(runId, seq++, 'permission_denied', {
            tool: toolName,
            reason: decision.message,
          });
          return { behavior: 'deny', message: decision.message ?? 'Denied by profile.' };
        }
        return { behavior: 'allow', updatedInput: input };
      },
    };

    // Only a builder can change the tree, so only a builder run gets a diff.
    // Snapshotting is read-only git; a non-repo cwd simply yields nothing.
    const before = req.permissionProfile === 'builder' ? await snapshotRepo(cwd) : null;

    try {
      for await (const message of query({ prompt: req.prompt, options }) as AsyncIterable<SDKMessage>) {
        this.record(runId, seq++, message.type, message);

        if (!sessionId && 'session_id' in message && message.session_id) {
          sessionId = message.session_id;
          this.store.setSessionId(runId, sessionId);
        }

        if (message.type === 'result') {
          const result = message as Extract<SDKMessage, { type: 'result' }>;
          const errored = result.subtype !== 'success' || result.is_error;
          this.store.finishRun(runId, {
            status: errored ? 'error' : 'success',
            durationMs: result.duration_ms,
            costUsd: result.total_cost_usd,
            numTurns: result.num_turns,
            sessionId,
            error: errored ? (result.subtype ?? 'run failed') : null,
          });
        }
      }

      // A stream that ends without a result message is still a finished run.
      const run = this.store.getRun(runId);
      if (run?.status === 'running') {
        this.store.finishRun(runId, {
          status: controller.signal.aborted ? 'cancelled' : 'error',
          sessionId,
          error: controller.signal.aborted ? 'cancelled' : 'stream ended without a result message',
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.record(runId, seq++, 'error', { message });
      this.store.finishRun(runId, {
        status: controller.signal.aborted ? 'cancelled' : 'error',
        sessionId,
        error: message,
      });
    } finally {
      if (before) {
        // Captured before `run:finished` goes out, so a client that refetches on
        // that event already finds the diff. A failure here must not mask the run.
        try {
          const after = await snapshotRepo(cwd);
          if (after) this.store.saveChanges(runId, changesBetween(before, after));
        } catch (err) {
          this.record(runId, seq++, 'error', {
            message: `Could not capture the run's changes: ${err instanceof Error ? err.message : String(err)}`,
          });
        }
      }

      this.active.delete(runId);
      this.bus.broadcast({ kind: 'run:finished', runId });

      const finished = this.store.getRun(runId);
      const waiters = this.waiters.get(runId) ?? [];
      this.waiters.delete(runId);
      if (finished) for (const resolve of waiters) resolve(finished);
    }
  }
}
