# Cockpit — setup

Everything below runs on your machine. Nothing here is done yet — the app is
built and tested, but it has never talked to your real Notion workspace or your
real repos.

Budget about 20 minutes. Steps 1–5 are required; 6–8 are the first real use;
9–10 are optional.

**Shortcut:** after cloning, run `npm run preflight`. It checks every prerequisite,
creates `.env`, and verifies the Notion connection — then tells you exactly what
is left. Re-run it after each fix. Then `npm run link-repos` wires your clones to
the registry. The only thing neither can do for you is create the Notion
integration (step 3), which is a browser flow in your account.

---

## 1. Prerequisites

```sh
node -v     # must be 22 or newer
npm -v      # ships with Node
claude -v   # Claude Code CLI, logged in
```

### Using your Claude subscription, not an API key

Cockpit never asks for an API key. Agents run through the Claude Code binary,
which bills against whatever that binary is logged in as. So:

```sh
claude auth login     # sign in with your Claude account
claude auth status    # want: "authMethod": "oauth_token"
```

`oauth_token` means your subscription. Anything else means API credits.

**The catch:** if `ANTHROPIC_API_KEY` is set *anywhere*, it silently overrides
that login and bills API credits instead — no error, no warning at run time.
It can hide in three places, and only the first is obvious:

1. your shell profile (`~/.zshrc`, `~/.bashrc`)
2. the `env` block of `~/.claude/settings.json`
3. `.env` in this repo

`npm run preflight` checks all three and tells you which one it found. It also
flags `apiKeyHelper` in your Claude settings, which does the same thing by a
different route.

Headless runs (dreams, the librarian) draw on the monthly **Agent SDK credit**,
which is separate from your interactive plan limits — so overnight dreams do not
eat your daytime quota. Claim it once in your Claude settings if you have not.

---

## 2. Clone and install

```sh
git clone <your-repo-url> cockpit
cd cockpit
git checkout main
npm install
```

`npm install` compiles `better-sqlite3`, so it takes a minute the first time.

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

## 4. Link your clones to the registry

```sh
npm run link-repos
```

For every project in the Cockpit Registry, this reads the project's Notion page
for its GitHub URL, finds the local clone whose **git remote** matches, and
writes that path into the registry row. Run it once per machine.

Matching by remote, not by name, is deliberate: BotAI's repository is
`autobot33`. A name-based guess would silently miss it.

For a project with no clone on this machine it prints the exact `git clone`
command. Run those you want, then re-run `link-repos`.

Two things to know:

- The URL comes from the page's **Repo & Deploy** table, the one the portfolio
  template defines. A page that predates the template (LaunchPad does) has none,
  so its URL sits in `cockpit.config.ts` under `repoUrl` instead. Adding the
  table to the page lets you drop the config entry.
- The registry is the source of truth for paths. `cockpit.config.ts` is for
  overrides only — a `repoPath` there pins a clone by hand and wins.

Until a project is linked, its card reads *"repo not found on this machine"*
and runs and dreams for it refuse to start. Cards for unlinked projects still
show — the overview works before every repo is wired.

---

## 5. First boot

```sh
npm run dev
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

Click **Dream now** on the LaunchPad card, or run it from a terminal:

```sh
npm run dream -- --project LaunchPad --force
```

Takes a minute or two. On success it prints the health, the run id, and a link
to the Dream Log page it created.

**This is the first time any of this touches the Notion API for real.** Check
three places:

1. Under LaunchPad's project page in Notion there is now a **🌙 Dream Log** child
   page with a dated section.
2. The registry row's `Status`, `Last dream`, and `Next step` are filled in.
3. `npm run dev` → **CEO Inbox** shows the report.

In the inbox, try each control: **Approve → run** on an action (it launches a
pre-filled run), **Ask follow-up** (an observer seeded with the report), and
**Dismiss**.

> If the run fails with *"Dream contract not met"*, that is by design — the model
> did not end with valid JSON. It shows up under **Failed dreams** in the inbox
> rather than disappearing. Re-run it; if it fails repeatedly, the prompt needs a
> tighter output contract.

Once this works, dreams run automatically at **02:00 every night**, as long as
`npm run dev` is running. Only projects with `Dream = ✓`, one at a time, max 3 per
night. A project whose git and session activity predate its last dream is
skipped unless you pass `--force`.

---

## 8. First librarian pass

Click **Run librarian now** under **Agents & Skills**, or run it from a terminal:

```sh
npm run librarian
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

**Agent SDK credit.** Headless runs (dreams, librarian, `npm run dream`) draw on the
monthly Agent SDK credit, separate from your interactive plan limits — so
overnight dreams do not eat your daytime quota. Claim it once in your Claude
settings if you have not. Decide the extra-usage toggle deliberately: with it on,
overages bill at API rates; with it off, runs stop at the ceiling. If the credit
runs low, drop dreams to 3×/week (`schedule: '0 2 * * 1,3,5'`) before changing
anything else.

Watch the **7-day spend** figure on the portfolio for the first week. Measured
on the real Launchpad repo, one dream costs about **$0.90** (34 turns, ~3 min).
A small repo is nearer $0.20. Three projects nightly is roughly $50–80/month.

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
| `Notion rejected NOTION_TOKEN … as invalid` | The token was revoked, rotated, or mistyped. Copy a current one from the integrations page (step 3). |
| *"NOTION_TOKEN comes from your shell environment"* | An `export NOTION_TOKEN=…` in `~/.zshrc` overrides `.env`, so editing the file changes nothing. `unset NOTION_TOKEN`. |
| `The Cockpit Registry … is not visible to this integration` | Hub page not shared with the integration (step 3.4). |
| `Could not read the Cockpit Registry … 404` | Same. |
| Card says *repo not found on this machine* | `repoPath` still wrong (step 4). |
| Runs refuse with `repo_not_found` | Same. |
| `The API did not come up on port 4201` | Server crashed at boot — read the `[server]` lines above it. |
| `Port 4201 is already in use` | Another `npm run dev` is still running, or use `PORT=4300 npm run dev`. |
| Repeated `ws proxy error … ECONNREFUSED 127.0.0.1:4201` | A symptom, never the cause: the API is down. `npm run dev` now stops and prints the real error instead. |
| Dreams never fire | `npm run dev` is not running, or no row has `Dream = ✓`. |
| Dream says *skipped — nothing changed* | Working as intended. `--force` overrides. |
| `CLAUDE_SDK_CAN_USE_TOOL_SHADOWED` warning | Expected. The `PreToolUse` hook is the real permission gate; see `apps/server/src/runtime/executor.ts`. |
