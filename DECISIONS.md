# Cockpit — where we are, and the decisions

*2026-09-05. A review against the original brief, written after reading the
actual Notion workspace rather than assuming its shape.*

## The promise

One local page — `localhost:4200` — that answers, for every project in the
portfolio: *where is it, what moved, what's next, what's blocked.* Overnight
"dreams" review each project against its repo and its Notion page and land
three concrete next actions in a CEO inbox. Approving one becomes an agent run
on that repo. Weekly, a librarian proposes skills. Everything durable lands in
Notion; the app is a control plane, not another agent framework.

That is the brief's §2, and it still holds. Nothing learned since has argued
for a different product.

## Where we are

**Code: complete against the brief.** M0–M3 built, 91 tests, typecheck clean.
Every path has been exercised for real except one: agents run, permissions are
enforced in code and adversarially tested, a real dream against the real
Launchpad repo produced a good report, the librarian produced two correct
proposals, the parser survives fuzzing.

**In service: never.** The Notion API write path — Dream Log page, registry row
mirror — has not run once, because it needs an internal integration token that
only the founder can create. Every merge since August has sharpened a tool that
has not yet cut anything. The dream said it about LaunchPad and it applies
equally here: *engineering is the comfortable work; the unglamorous step keeps
not happening.*

**The registry now reflects the portfolio.** Fourteen projects across three
active tiers, read straight from the hub. Before today it held one.

## Is the objective clear?

Yes — and clearer than when we started, because the Notion read exposed a house
standard the brief did not mention: the *OpenClaw-Parseable Project Page
Template*, with fixed `AGENT_CONTEXT`, `BACKLOG`, and `DECISION LOG` sections.
Cockpit is the reader that standard was written for. The dream now consumes
those sections; the repo resolver reads the `Repo & Deploy` table. Where a page
predates the template, both degrade to the page's opening rather than fail.

One thing the objective is **not**: a replacement for Notion, OpenClaw, or the
Three-Body pattern. It reads them and writes back to them. That boundary is what
keeps it small.

## Decisions taken

1. **Populate the registry from the hub.** Fourteen rows, `Dream` ticked on
   LaunchPad only. The overview is the promise; one card was not it.

2. **Repo paths resolve by git remote, from Notion.** `npm run link-repos` reads
   each page's GitHub URL, finds the clone whose `origin` matches, and writes
   the path into the registry. Names are never matched: BotAI's repo is
   `autobot33`. `cockpit.config.ts` becomes override-only. This retires the
   placeholder that has blocked setup since August.

3. **Dreams read the project page.** `AGENT_CONTEXT`, `DECISION LOG`, `BACKLOG`
   when present; the page head otherwise. A locked decision is closed — the
   prompt says so. This stops the loop re-asking questions the founder already
   answered.

4. **Tier list completed** to the hub's five sections. Not derived from page
   position: at fourteen rows a select that can drift is cheaper than a
   structure you must move pages to change. Revisit at forty.

5. **`Primary Blocker` vs the dream's `Next step` — deferred.** Two answers to
   one question in two places, against the template's "one source of truth per
   field". Now that the dream *reads* the blocker, the duplication is less
   dangerous. Resolve after dreams are writing nightly, with real examples.

6. **Stop hardening.** No further parser, permission, or Notion-shape work until
   a dream has landed in Notion once. The next code should exist to make that
   happen or to act on what it reveals.

## What only the founder can do

Create the Notion integration and connect it to *Convergence Labs Projects*.
Two minutes, browser only. Then, in order:

```sh
npm run preflight
npm run link-repos
npm run dream -- --project LaunchPad --force
```

The third command is the last unverified thing in the system.

## What happens without the founder

- Registry stays populated; cards render the moment a token exists.
- Dreams run nightly at 02:00 on `Dream = ✓` projects, once the app is up.
- The librarian runs Mondays.
- Nothing installs itself. Nothing writes outside the registry and Dream Logs.

## What we are deliberately not building

The brief's §15 backlog, unchanged: embedded terminal, Telegram push, Routines
migration, rubric scoring, a cross-project portfolio dream. Each is a real idea.
None is worth more than one night of the loop actually running.
