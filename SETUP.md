# Cockpit — setup

Everything below runs on your machine. Nothing here is done yet — the app is
built and tested, but it has never talked to your real Notion workspace or your
real repos.

Budget about 20 minutes. Steps 1–5 are required; 6–8 are the first real use;
9–10 are optional.

---

## 1. Prerequisites

```sh
node -v     # must be 22 or newer
pnpm -v     # 10.x
claude -v   # Claude Code CLI, logged in
```

If `claude` is missing or logged out, install it and run `claude` once to sign
in. Cockpit uses that OAuth session — it never asks you for an API key.

**Check that `ANTHROPIC_API_KEY` is unset:**

```sh
echo "${ANTHROPIC_API_KEY:-(unset — good)}"
```

If it prints a key, remove it from your shell profile. When set, the Agent SDK
silently ignores your subscription and bills API credits instead. The server
warns at boot if it finds one, but it will not override it for you.

---

## 2. Clone and install

```sh
git clone <your-repo-url> cockpit
cd cockpit
git checkout claude/cockpit-app-build-ufo8gl
pnpm install
```

`pnpm install` compiles `better-sqlite3`, so it takes a minute the first time.

---

## 3. Notion integration token

The server reads the registry and writes dream results through the Notion API,
so it needs an internal integration token.

1. Go to <https://www.notion.so/profile/integrations> → **New integration**.
2. Name it `Cockpit`, associate it with your workspace, and give it
   **Read**, **Update**, and **Insert** content capabilities.
3. Copy the token (it starts with `ntn_`).
4. Open the **Convergence Labs Projects** page in Notion → `···` (top right) →
   **Connections** → **Connect to** → `Cockpit`.

That one share is enough. The **Cockpit Registry** database and every Dream Log
page live under that hub and inherit the access.

Then:

```sh
cp .env.example .env
```

and put the token in `.env`:

```
NOTION_TOKEN=ntn_your_token_here
PORT=4200
```

> If you skip the page-sharing step, the server boots and exits with
> `Could not read the Cockpit Registry: ... 404`. That error means "shared with
> the integration?", not "wrong token".

---

## 4. Point LaunchPad at its real repo ← **this one blocks everything**

`cockpit.config.ts` line 33 is still a placeholder:

```ts
repoPath: '~/dev/launchpad',
```

Change it to wherever LaunchPad is actually cloned, e.g.:

```ts
repoPath: '~/code/launchpad',
```

Until you do, the card reads *"repo not found on this machine"*, and both runs
and dreams refuse to start.

**Gotcha:** the registry row in Notion also has a `Repo path` column, but
`cockpit.config.ts` **wins** for any project listed there. Editing only the
Notion column will appear to do nothing for LaunchPad. Notion's column is the
fallback for projects you have not listed in the config.

---

## 5. First boot

```sh
pnpm dev
```

Open <http://localhost:4200>. You should see a **STRATEGIC BETS** section with a
LaunchPad card: grey dot, `DREAM` badge, *"never dreamed"*, and a real last-commit
age instead of *"repo not found"*.

Sanity check that the sync is live: tick or untick `Dream` on the registry row in
Notion, hit **Refresh**, and watch it change.

---

## 6. First agent run

Click the **LaunchPad** card → **Talk to this project**. Leave the profile on
**observer** and try:

```
Read the README and the last 10 commits. In five bullets, tell me what is
actually built versus what is only planned.
```

Press **Run** (or ⌘↵). You land on the run detail screen and watch it stream.
When it finishes you get turns, duration, and cost. Reload the page — the
identical stream replays from SQLite.

Then try **builder** on something small and reversible, so you have seen it edit
a file before a dream proposes one.

---

## 7. First dream

```sh
pnpm dream --project LaunchPad --force
```

Takes a minute or two. On success it prints the health, the run id, and a link
to the Dream Log page it created.

**This is the first time any of this touches the Notion API for real.** Check
three places:

1. Under LaunchPad's project page in Notion there is now a **🌙 Dream Log** child
   page with a dated section.
2. The registry row's `Status`, `Last dream`, and `Next step` are filled in.
3. `pnpm dev` → **CEO Inbox** shows the report.

In the inbox, try each control: **Approve → run** on an action (it launches a
pre-filled run), **Ask follow-up** (an observer seeded with the report), and
**Dismiss**.

> If the run fails with *"Dream contract not met"*, that is by design — the model
> did not end with valid JSON. It shows up under **Failed dreams** in the inbox
> rather than disappearing. Re-run it; if it fails repeatedly, the prompt needs a
> tighter output contract.

Once this works, dreams run automatically at **02:00 every night**, as long as
`pnpm dev` is running. Only projects with `Dream = ✓`, one at a time, max 3 per
night. A project whose git and session activity predate its last dream is
skipped unless you pass `--force`.

---

## 8. First librarian pass

```sh
pnpm librarian
```

Proposals land in `skills-proposed/` and appear under **Agents & Skills**. Read
the draft before clicking **Install** — that button copies a SKILL.md into your
real skills directory, and a SKILL.md is instructions your agents will obey.
Nothing installs on its own, by design.

Runs weekly on Mondays at 03:00 thereafter.

---

## 9. Recommended: keep session history longer

Cockpit reads `~/.claude/projects/*.jsonl` mtimes for the "last activity" signal,
and the librarian scans them for instructions you repeat. Claude Code prunes
these by default. In `~/.claude/settings.json`:

```json
{
  "cleanupPeriodDays": 90
}
```

Without this the friction scan usually finds nothing, and the librarian falls
back to auditing your existing skills — useful, but it will not spot missing ones.

---

## 10. Optional: billing posture, and adding more projects

**Agent SDK credit.** Headless runs (dreams, librarian, `pnpm dream`) draw on the
monthly Agent SDK credit, separate from your interactive plan limits — so
overnight dreams do not eat your daytime quota. Claim it once in your Claude
settings if you have not. Decide the extra-usage toggle deliberately: with it on,
overages bill at API rates; with it off, runs stop at the ceiling. If the credit
runs low, drop dreams to 3×/week (`schedule: '0 2 * * 1,3,5'`) before changing
anything else.

Watch the **7-day spend** figure on the portfolio for the first week. A dream
costs roughly $0.20–0.80 depending on repo size.

**Adding BotAI, 11bis, or others.** Two steps:

1. Add a row to the **Cockpit Registry** in Notion: `Name`, `Project page` (URL of
   the existing project page), `Tier`, `Repo path`, and tick `Dream` if you want
   it in the nightly loop.
2. Optionally add a `{ notionPageId, repoPath }` entry to `cockpit.config.ts` —
   only needed if you want the config to override the Notion column.

No restart needed for step 1; the portfolio reads Notion live.

---

## Where things live

| | |
| --- | --- |
| Durable state | Notion — registry, Dream Logs. Deleting `cockpit.db` loses nothing strategic. |
| Telemetry | `cockpit.db` (gitignored) — runs, streams, costs. |
| Agent definitions | `agents/*.yaml`, editable in the UI or on disk. |
| Prompts | `prompts/dream.md`, `prompts/librarian.md`. |
| Staged proposals | `skills-proposed/` (contents gitignored). |
| Config | `cockpit.config.ts` — Notion ids, schedules, repo paths. |

## Troubleshooting

| Symptom | Cause |
| --- | --- |
| `NOTION_TOKEN is not set` | No `.env`, or the variable is empty. |
| `Could not read the Cockpit Registry … 404` | Hub page not shared with the integration (step 3.4). |
| Card says *repo not found on this machine* | `repoPath` still wrong (step 4). |
| Runs refuse with `repo_not_found` | Same. |
| `The API did not come up on port 4201` | Server crashed at boot — read the `[server]` lines above it. |
| Dreams never fire | `pnpm dev` is not running, or no row has `Dream = ✓`. |
| Dream says *skipped — nothing changed* | Working as intended. `--force` overrides. |
| `CLAUDE_SDK_CAN_USE_TOOL_SHADOWED` warning | Expected. The `PreToolUse` hook is the real permission gate; see `apps/server/src/runtime/executor.ts`. |
