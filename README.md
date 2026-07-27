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
- M1 — Run & watch
- M2 — Dreams
- M3 — Librarian & polish
