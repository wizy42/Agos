/**
 * Shared types across the Cockpit server and web app.
 *
 * Notion is durable state (registry, dream logs, decisions).
 * SQLite is telemetry (runs, streams, costs). Nothing strategic lives only here.
 */

export const TIERS = ['SHIP NOW', 'BUILD NEXT', 'STRATEGIC BETS'] as const;
export type Tier = (typeof TIERS)[number];

export const HEALTHS = ['green', 'orange', 'red'] as const;
export type Health = (typeof HEALTHS)[number];

/** Read-only activity signal from git + Claude Code session files. Never load-bearing. */
export interface ProjectActivity {
  /** False when the configured repo path does not exist on this machine. */
  repoFound: boolean;
  branch: string | null;
  lastCommitAt: string | null;
  lastCommitSubject: string | null;
  /** True when the working tree has uncommitted changes. */
  dirty: boolean;
  /**
   * Most recent mtime across `~/.claude/projects/<encoded-repo-path>/*.jsonl`.
   * Best-effort only — the JSONL layout is internal and version-unstable.
   */
  lastSessionAt: string | null;
}

/** One row of the Cockpit Registry database, joined with local activity. */
export interface Project {
  /** Notion page id of the registry row. */
  id: string;
  name: string;
  /** URL of the existing Notion project page, for deep-linking. */
  projectPageUrl: string | null;
  /** URL of the registry row itself. */
  registryRowUrl: string;
  tier: Tier | null;
  status: Health | null;
  repoPath: string | null;
  /** Opted into the nightly dream loop. */
  dream: boolean;
  lastDream: string | null;
  nextStep: string | null;
  activity: ProjectActivity | null;
}

export type PermissionProfile = 'observer' | 'builder' | 'notion-writer';

/** An `agents/*.yaml` definition, after parsing but before interpolation. */
export interface AgentDef {
  name: string;
  model: string;
  /** May contain `${project.repoPath}`. */
  cwd: string;
  permissionProfile: PermissionProfile;
  allowedTools: string[];
  mcp: string[];
  maxTurns: number;
  /** Path to the prompt template, relative to the repo root. */
  prompt: string;
}

export type RunStatus = 'running' | 'success' | 'error' | 'cancelled';

export interface Run {
  id: string;
  agentName: string;
  /** Registry row id of the project this run targeted, if any. */
  projectId: string | null;
  cwd: string;
  permissionProfile: PermissionProfile;
  status: RunStatus;
  startedAt: string;
  endedAt: string | null;
  durationMs: number | null;
  costUsd: number | null;
  numTurns: number | null;
  /** SDK session id, for resume. */
  sessionId: string | null;
  error: string | null;
}

/** One persisted SDK message from a run, replayable in order. */
export interface RunEvent {
  id: number;
  runId: string;
  seq: number;
  at: string;
  /** SDK message type: system | assistant | user | result | stream_event. */
  type: string;
  /** Raw SDK message, JSON-encoded. */
  payload: unknown;
}

export interface ProposedAction {
  title: string;
  why: string;
  agent: string;
  prompt: string;
}

/** The single JSON block a dream run must end with. */
export interface DreamReport {
  project: string;
  where_we_are: string;
  what_moved: string[];
  risks: string[];
  proposed_next_actions: ProposedAction[];
  questions_for_ceo: string[];
  health: Health;
}
