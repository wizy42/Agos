# 🎛️ Cockpit — Convergence Labs Agent OS

A local control plane for the Convergence Labs portfolio. Claude Code stays the
executor, Notion stays the memory; Cockpit is the surface that answers *where is
each project, what moved, what's next, what's blocked*.

## Setup

**First time? Follow [SETUP.md](SETUP.md)** — it walks the whole thing end to
end. The one step only you can do is the Notion integration; everything else
is a command.

The short version:

```sh
npm install
cp .env.example .env      # then paste your NOTION_TOKEN
npm run link-repos        # match your clones to the registry by git remote
npm run dev                  # → http://localhost:4200
```

`NOTION_TOKEN` is an internal integration token from
<https://www.notion.so/profile/integrations>. After creating it, open the
**Convergence Labs Projects** hub page in Notion → `···` → **Connections** → add
the integration. The **Cockpit Registry** database inherits that access.

Leave `ANTHROPIC_API_KEY` **unset**. If it is set, the Agent SDK silently
overrides your Claude Code subscription auth and bills API credits instead.

**No Notion yet?** `COCKPIT_STUB=1 npm run dev` boots the same UI against an
in-memory registry of three sample projects. One of them is this repo, so its
card shows real git activity; another names a clone that is not on this
machine, so that state shows too. Nothing is read from or written to Notion,
and the project wizard, dreams, the librarian and the President answer 503. It is for looking
at the UI in a sandbox, in CI, or on a laptop where the integration does not
exist yet — `npm run preflight` still reports the missing token.

## Layout

```
apps/server/        Fastify API, Notion sync, read-only git/session ingestors
apps/web/           Vite + React + Tailwind UI
packages/core/      shared types: Project, AgentDef, Run, DreamReport, PresidentReport
agents/             dream-reviewer, skill-librarian, president — YAML, editable in the UI
prompts/            the prompt template each agent runs with
cockpit.config.ts   Notion ids, schedules, per-project overrides (repoUrl / repoPath)
```

## Notion

- **Cockpit Registry** — one row per tracked project, under the hub page.
  Edit `Repo path` and `Dream` here; `Status`, `Last dream`, and `Next step`
  are written by the dream loop.
- **Add project** on the Portfolio screen lists every hub page not yet in the
  registry, grouped by tier. Pick one, adjust the name, and the row is created
  with `Dream` off; the repo is linked on the spot when a clone matches the
  page's GitHub URL, exactly as `link-repos` would do it.
- Property names are introspected at boot, so renaming a column in Notion does
  not break the server.

## Milestones

- **M0 — Skeleton & sync** ✅ registry created, pilot registered, portfolio renders live Notion data
- **M1 — Run & watch** ✅ launch observer/builder runs, live stream, cost + replayable detail
- **M2 — Dreams** ✅ YAML agents, nightly cron, dream contract, Dream Log writes, CEO inbox
- **M3 — Librarian & polish** ✅ skills inventory, weekly librarian, staging with install/reject
- **M4 — President** ✅ weekly cross-project review: six dimensions, ranked priorities, Portfolio Log

Build stops at M4. New ideas go to the brief's backlog, not into the app.

## President

Dreams look at one project a night. The President looks at all of them once a
week and answers what no single dream can: *where is the company*, on six
dimensions — **product, legal, marketing, traction, tooling, assets** — and
*what are the five things, across every project, that move it closest to
revenue*. Priorities are cross-project and ranked; three of five may land on
one project if that is the truth. A priority may be to pause or kill one.

**Run President now** on the **President** screen starts a pass and follows
the run. The dropdown next to it keeps the whole portfolio in view but weights
the pass toward one project. From a terminal:

```sh
npm run president                       # the weekly pass, by hand
npm run president -- --focus LaunchPad  # same, weighted toward one project
```

Weekly at `president.schedule` (Monday 04:00, after the librarian). Inputs,
per live project: the registry row and git activity, the Notion page extract
(`AGENT_CONTEXT`, `DECISION LOG`, `BACKLOG`), the last dream report, the last
two weeks of commits, and the founder's recent Claude Code sessions on this
disk — one line per session, what was asked. Plus the previous President
report, so the loop notices what did not move. Archived projects get a name,
not a section. Sessions run on claude.ai/code are not on this disk and the
brief says so rather than guessing.

The agent runs with the **observer** profile from the Cockpit root: it may read
any tracked repo by absolute path and nothing else. It ends with a single JSON
block; the server parses it, appends a dated section to the **Portfolio Log**
page under the hub (created on first use, nothing else restructured), and
drops the report into the CEO inbox. Each priority names an `agent`:
`builder` or `observer` approves into a run on that project, exactly like a
dream action; `founder` is the kind no agent can do — a sale, a signature, a
conversation — and is shown as the instruction it is. A parse failure is a
**failed run surfaced in the inbox**, never a silent drop.

`prompts/president.md` carries the same bias rule as dreams: a report whose
five priorities are all engineering is a bad report. It also says what the
agent must not do: estimate traction numbers the pages do not carry, or call
legal "fine" when the pages carry nothing on it. The President is only as
honest as the project pages — a line of `MRR`, `legal status` or `channels
tried` in `AGENT_CONTEXT` is what turns those dimensions from guesses into
findings.

## Skill librarian

**Run librarian now** in **Agents & Skills** starts a pass and drops you on its
live stream. From a terminal:

```sh
npm run librarian          # run the weekly pass now
```

Weekly at `librarian.schedule` (Monday 03:00). Inputs: every installed skill
(`~/.claude/skills/*` and each tracked repo's `.claude/skills/*`), the last 7
days of dream reports, and a best-effort scan of recent session transcripts for
instructions typed more than once — repetition is the signal that a skill is
missing.

Output is staged in `skills-proposed/<name>/`: new-skill drafts, rewrites with a
diff, deprecation candidates, and links to public skills.

**Nothing is ever auto-installed.** A SKILL.md is instructions your agents will
obey, so an unreviewed one — especially a third-party one — is a prompt-injection
vector. The librarian is read-only and writes nothing; only the explicit Install
action in **Agents & Skills** copies a draft into a real skills directory, and it
refuses any destination outside a known skills root. Public skills are linked,
never fetched. This is the one security rule that survives "it's local".

## Dreams

**Dream now** on any project card — or in its header — reviews that project
immediately and follows the run. It is always forced: clicking the button is
the intent the "nothing changed" check exists to guess at. From a terminal:

```sh
npm run dream -- --project LaunchPad --force   # run one now
npm run dream                               # the nightly sweep, by hand
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

`npm test` covers the gate directly.

## What a builder changed

A builder run's detail page has a **Changes** section: the working tree's diff
against `HEAD` plus any new files, captured the moment the run ends and stored
with the run. Snapshots are read-only git — nothing is stashed, staged, or
committed on your behalf. If the tree was already dirty before the run, the
section says so instead of guessing which lines are the agent's.
