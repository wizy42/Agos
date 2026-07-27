# 🎛️ Cockpit — Convergence Labs Agent OS

A local control plane for the Convergence Labs portfolio. Claude Code stays the
executor, Notion stays the memory; Cockpit is the surface that answers *where is
each project, what moved, what's next, what's blocked*.

## Setup

```sh
pnpm install
cp .env.example .env      # then paste your NOTION_TOKEN
pnpm dev                  # → http://localhost:4200
```

`NOTION_TOKEN` is an internal integration token from
<https://www.notion.so/profile/integrations>. After creating it, open the
**Convergence Labs Projects** hub page in Notion → `···` → **Connections** → add
the integration. The **Cockpit Registry** database inherits that access.

Leave `ANTHROPIC_API_KEY` **unset**. If it is set, the Agent SDK silently
overrides your Claude Code subscription auth and bills API credits instead.

## Layout

```
apps/server/        Fastify API, Notion sync, read-only git/session ingestors
apps/web/           Vite + React + Tailwind UI
packages/core/      shared types: Project, AgentDef, Run, DreamReport
cockpit.config.ts   Notion ids, dream schedule, notionPageId ↔ repoPath map
```

## Notion

- **Cockpit Registry** — one row per tracked project, under the hub page.
  Edit `Repo path` and `Dream` here; `Status`, `Last dream`, and `Next step`
  are written by the dream loop.
- Property names are introspected at boot, so renaming a column in Notion does
  not break the server.

## Milestones

- **M0 — Skeleton & sync** ✅ registry created, pilot registered, portfolio renders live Notion data
- **M1 — Run & watch** ✅ launch observer/builder runs, live stream, cost + replayable detail
- **M2 — Dreams** ✅ YAML agents, nightly cron, dream contract, Dream Log writes, CEO inbox
- M3 — Librarian & polish

## Dreams

```sh
pnpm dream --project LaunchPad --force   # run one now
pnpm dream                               # the nightly sweep, by hand
```

Nightly at `dream.schedule` in `cockpit.config.ts` (02:00 every night), sequential,
opted-in projects only (`Dream = ✓`), capped at `maxProjectsPerNight`. A project
whose git and session mtimes are older than its last dream is skipped unless
`--force`.

The agent ends with a single JSON block. The server parses it, appends a dated
section to the project's Dream Log in Notion, mirrors health / last dream / next
step onto the registry row, and drops the report into the CEO inbox. A parse
failure is a **failed run surfaced in the inbox**, never a silent drop.

Dream Log pages are created lazily — on a project's first dream, under its
existing Notion page, falling back to its registry row. Nothing is restructured.

`prompts/dream.md` carries the bias rule: shipping and revenue outrank refactors
and plans. A review proposing three refactors and zero customer-facing steps is
a bad review, and the prompt says so.

## Permission profiles

Enforced in code, never by prompt. Both layers run on every tool call:

| Profile | Tools | Enforcement |
| --- | --- | --- |
| `observer` | Read, Glob, Grep, WebSearch, read-only git | Denies non-git shell, chained/redirected commands, all writes |
| `builder` | + Edit, Write, Bash | `acceptEdits`, confined to the project repo |

The gate is a `PreToolUse` hook rather than `canUseTool` alone. The hook fires
for *every* tool call, including ones the SDK's classifier would auto-approve
without prompting — `canUseTool` never sees those, so an observer could
otherwise shell out to any command deemed read-only, `ls` and `cat` included.

`pnpm test` covers the gate directly.
