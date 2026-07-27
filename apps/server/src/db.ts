import Database from 'better-sqlite3';
import { resolve } from 'node:path';
import type { Run, RunEvent, RunStatus } from '@cockpit/core';

/**
 * SQLite is telemetry only — runs, streams, costs.
 * Deleting this file must lose nothing strategic; that lives in Notion.
 */

export interface RunRow {
  id: string;
  agent_name: string;
  project_id: string | null;
  cwd: string;
  permission_profile: string;
  prompt: string;
  status: string;
  started_at: string;
  ended_at: string | null;
  duration_ms: number | null;
  cost_usd: number | null;
  num_turns: number | null;
  session_id: string | null;
  error: string | null;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS agents (
  name       TEXT PRIMARY KEY,
  definition TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS runs (
  id                 TEXT PRIMARY KEY,
  agent_name         TEXT NOT NULL,
  project_id         TEXT,
  cwd                TEXT NOT NULL,
  permission_profile TEXT NOT NULL,
  prompt             TEXT NOT NULL,
  status             TEXT NOT NULL,
  started_at         TEXT NOT NULL,
  ended_at           TEXT,
  duration_ms        INTEGER,
  cost_usd           REAL,
  num_turns          INTEGER,
  session_id         TEXT,
  error              TEXT
);
CREATE INDEX IF NOT EXISTS runs_started_at ON runs (started_at DESC);
CREATE INDEX IF NOT EXISTS runs_project    ON runs (project_id, started_at DESC);

CREATE TABLE IF NOT EXISTS run_events (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id  TEXT NOT NULL REFERENCES runs (id) ON DELETE CASCADE,
  seq     INTEGER NOT NULL,
  at      TEXT NOT NULL,
  type    TEXT NOT NULL,
  payload TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS run_events_seq ON run_events (run_id, seq);

-- Dream reports land here at M2. The durable copy always goes to Notion.
CREATE TABLE IF NOT EXISTS reports (
  id         TEXT PRIMARY KEY,
  run_id     TEXT NOT NULL REFERENCES runs (id) ON DELETE CASCADE,
  project_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  health     TEXT,
  json       TEXT NOT NULL,
  reviewed   INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS reports_project ON reports (project_id, created_at DESC);
`;

function toRun(row: RunRow): Run {
  return {
    id: row.id,
    agentName: row.agent_name,
    projectId: row.project_id,
    cwd: row.cwd,
    permissionProfile: row.permission_profile as Run['permissionProfile'],
    prompt: row.prompt,
    status: row.status as RunStatus,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    durationMs: row.duration_ms,
    costUsd: row.cost_usd,
    numTurns: row.num_turns,
    sessionId: row.session_id,
    error: row.error,
  };
}

export class Store {
  private readonly db: Database.Database;

  constructor(repoRoot: string) {
    this.db = new Database(resolve(repoRoot, 'cockpit.db'));
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.db.exec(SCHEMA);
  }

  createRun(run: {
    id: string;
    agentName: string;
    projectId: string | null;
    cwd: string;
    permissionProfile: string;
    prompt: string;
    startedAt: string;
  }): void {
    this.db
      .prepare(
        `INSERT INTO runs (id, agent_name, project_id, cwd, permission_profile, prompt, status, started_at)
         VALUES (@id, @agentName, @projectId, @cwd, @permissionProfile, @prompt, 'running', @startedAt)`,
      )
      .run(run);
  }

  appendEvent(runId: string, seq: number, type: string, payload: unknown): RunEvent {
    const at = new Date().toISOString();
    const json = JSON.stringify(payload);
    const info = this.db
      .prepare(`INSERT INTO run_events (run_id, seq, at, type, payload) VALUES (?, ?, ?, ?, ?)`)
      .run(runId, seq, at, type, json);

    return { id: Number(info.lastInsertRowid), runId, seq, at, type, payload };
  }

  finishRun(
    runId: string,
    patch: {
      status: RunStatus;
      durationMs?: number | null;
      costUsd?: number | null;
      numTurns?: number | null;
      sessionId?: string | null;
      error?: string | null;
    },
  ): void {
    this.db
      .prepare(
        `UPDATE runs SET status = @status, ended_at = @endedAt, duration_ms = @durationMs,
                         cost_usd = @costUsd, num_turns = @numTurns,
                         session_id = COALESCE(@sessionId, session_id), error = @error
         WHERE id = @runId`,
      )
      .run({
        runId,
        status: patch.status,
        endedAt: new Date().toISOString(),
        durationMs: patch.durationMs ?? null,
        costUsd: patch.costUsd ?? null,
        numTurns: patch.numTurns ?? null,
        sessionId: patch.sessionId ?? null,
        error: patch.error ?? null,
      });
  }

  setSessionId(runId: string, sessionId: string): void {
    this.db.prepare(`UPDATE runs SET session_id = ? WHERE id = ?`).run(sessionId, runId);
  }

  getRun(runId: string): Run | null {
    const row = this.db.prepare(`SELECT * FROM runs WHERE id = ?`).get(runId) as RunRow | undefined;
    return row ? toRun(row) : null;
  }

  listRuns(opts: { projectId?: string; limit?: number } = {}): Run[] {
    const limit = opts.limit ?? 50;
    const rows = opts.projectId
      ? (this.db
          .prepare(`SELECT * FROM runs WHERE project_id = ? ORDER BY started_at DESC LIMIT ?`)
          .all(opts.projectId, limit) as RunRow[])
      : (this.db
          .prepare(`SELECT * FROM runs ORDER BY started_at DESC LIMIT ?`)
          .all(limit) as RunRow[]);
    return rows.map(toRun);
  }

  /** Full ordered event log — this is what makes a run replayable. */
  listEvents(runId: string): RunEvent[] {
    const rows = this.db
      .prepare(`SELECT * FROM run_events WHERE run_id = ? ORDER BY seq ASC`)
      .all(runId) as { id: number; run_id: string; seq: number; at: string; type: string; payload: string }[];

    return rows.map((r) => ({
      id: r.id,
      runId: r.run_id,
      seq: r.seq,
      at: r.at,
      type: r.type,
      payload: JSON.parse(r.payload) as unknown,
    }));
  }

  /** Rolling spend, for the dashboard's 7-day number. */
  spendSince(days: number): { totalUsd: number; runs: number } {
    const since = new Date(Date.now() - days * 86_400_000).toISOString();
    const row = this.db
      .prepare(
        `SELECT COALESCE(SUM(cost_usd), 0) AS total, COUNT(*) AS n FROM runs WHERE started_at >= ?`,
      )
      .get(since) as { total: number; n: number };
    return { totalUsd: row.total, runs: row.n };
  }
}
