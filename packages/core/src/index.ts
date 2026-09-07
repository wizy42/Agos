/**
 * Shared types across the Cockpit server and web app.
 *
 * Notion is durable state (registry, dream logs, decisions).
 * SQLite is telemetry (runs, streams, costs). Nothing strategic lives only here.
 */

/**
 * The five tiers the hub page is organised into, in maturity order. A project
 * page's parent is its tier, so these names track the hub's own sections —
 * IDEAS and ARCHIVED included, or a row in either reads as untiered.
 */
export const TIERS = [
  'SHIP NOW',
  'BUILD NEXT',
  'STRATEGIC BETS',
  'IDEAS',
  'ARCHIVED',
] as const;
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
  prompt: string;
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

/**
 * What a builder run did to its repository: the working tree after the run,
 * diffed against HEAD. When the tree was already dirty before the run started,
 * `dirtyBefore` says so — the diff then includes changes the agent did not make.
 */
export interface RunChanges {
  headBefore: string | null;
  dirtyBefore: boolean;
  /** `git diff --stat` summary. */
  stat: string;
  /** Unified diff of tracked files. Capped; see `truncated`. */
  diff: string;
  /** New files the diff cannot show, since git does not know them yet. */
  untracked: string[];
  truncated: boolean;
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

/** One installed skill found on disk. */
export interface SkillEntry {
  name: string;
  title: string;
  description: string;
  path: string;
  scope: 'user' | 'project';
  /** Project name for repo-scoped skills, null for user-level ones. */
  owner: string | null;
  bytes: number;
  updatedAt: string;
}

export type ProposalKind = 'new' | 'rewrite' | 'deprecate';

/** A librarian proposal staged in `skills-proposed/`, awaiting a human. */
export interface SkillProposal {
  kind: ProposalKind;
  name: string;
  why: string;
  /** Draft body. Absent for deprecations. */
  skillMd?: string;
  /** For rewrites: the file this would replace, and what changes. */
  targetPath?: string;
  diff?: string;
  /** Where `skills-proposed/<name>/SKILL.md` was staged. Absent for deprecations. */
  stagedPath?: string;
}

/** A public skill worth a look. Linked only — never fetched, never installed. */
export interface PublicSkillLink {
  name: string;
  url: string;
  why: string;
}

export interface LibrarianReport {
  proposals: SkillProposal[];
  publicSkills: PublicSkillLink[];
  summary: string;
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
