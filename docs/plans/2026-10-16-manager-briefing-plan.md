# Manager briefing: plan

**Spec:** [docs/specs/2026-10-16-manager-briefing-design.md](../specs/2026-10-16-manager-briefing-design.md) (approved 2026-10-16) · **Research:** [docs/research/2026-10-16-manager-po-landscape.md](../research/2026-10-16-manager-po-landscape.md) · **Issues:** Linear project [grimoire · manager briefing](https://linear.app/odyyy/project/grimoire-manager-briefing-1da8f07b905f) (P-ODY-46), ODY-869 to ODY-878, plus ODY-879 (page) and ODY-880 (panel)

## Problem, in the user's words

> We would like to have a manager / PO that handles the Linear and inspects things, so he can report to us what is urgent and what needs to be done. The goal is to give us direction on what to do with AI, because we might forget.

## Solution, in the user's words

> He connects with Jira, GitHub Issues and Linear, using the tools that already exist. He lists what is urgent and what to hand to AI. We choose which to launch with checkboxes, some or all, with Claude if possible, else by copy-pasting the prompt he made. We choose to run with orchestrate or the loop, one conversation per project, after checking that the sub-repositories are available. It is tool-agnostic, configured during the grimoire setup, and setup can be launched again for an update.

## User stories

1. As a team member, I want to re-run `/grimoire:setup` on a project that is already set up and see one diff of what it would add or change, so that an update never overwrites what we configured by hand.
2. As a team member, I want `/grimoire:manager` to read our tracker and tell me what is urgent and what is stuck, grouped by what we owe, so that nothing important is forgotten.
3. As a team member, I want each item to say why it is there and what the next step is, so that I can act without opening every ticket.
4. As a team member, I want the briefing to include PRs waiting on us and grimoire runs that halted or went stale, so that the whole "what needs us" list is in one place.
5. As a team member, I want a one-line headline when I open a Claude session, and a warning when the briefing is stale, so that I see the state without asking.
6. As a team member, I want to tick the issues to hand to AI (some or all) and have each tracker project start in its own conversation, routed to `/orchestrate` or to supervised `/implement` → `/review`, so that launching work takes one step.
7. As a team member, I want the manager to check that each issue's repository or submodule is checked out before launching, and to give me the fix when it isn't, so that a run never starts on a missing repo.
8. As a team member, I want ready-to-paste prompts when Claude can't start the conversations itself, or when the briefing ran on a schedule, so that I can still launch from anywhere.
9. As a team member, I want the briefing to run daily on my machine under my own Claude login, with no API key, so that it is ready before I start.
10. As a team, we want an optional shared post, replaced on each run, so that everyone sees the same briefing.
11. As the owner of the harness, I want the manager's scouts to be unable to write to the tracker, whatever connector is installed, so that a read-only briefing stays read-only.
12. As a team member, I want a visual page of the briefing that I can open anywhere, filter, and copy a launch prompt from, so that I can review what needs us at a glance.
13. As a team member using the Claude desktop app, I want the briefing as an interactive panel in the conversation, where I tick issues and press Launch, so that reviewing and executing happen in one place without copy-paste.

## Seams

| Seam | What crosses it | Test file (style) |
| --- | --- | --- |
| **`scripts/manager.mjs` CLI** (new) | `brief`: WorkItems JSON + config + ledger + `--now` → briefing Markdown, headline, new ledger. `headline`. `repos`: the availability check. `launch-plan`: ticked ids → groups per project, routes, queue order, prompts. Reads grimoire runs by importing `loadRuns` and `runOutcome` from `scripts/render-logs.mjs` | `scripts/manager.test.mjs`: spawns the CLI against temp fixtures and real temp git repos and submodules, like `scripts/render-logs.test.mjs` |
| **Guard stdin** (existing) | A PreToolUse payload → exit 2 with a `grimoire guard:` line, or exit 0 | New cases in `hooks/scripts/guard.test.mjs` |
| **`scripts/config-merge.mjs` CLI** (new) | Current and proposed `grimoire.config.json` (or `.claude/settings.json`) → added / changed / kept lists, plus the merged file. A key the user didn't approve is never changed | `scripts/config-merge.test.mjs` |
| **Skill behaviour** (existing seam: `skills/*/evals/evals.json`) | The manager and setup skills, and the tracker-scout dispatch | **Subagent tests in a session**: one subagent runs each eval case against a fixture project, and a second grades it against the case's expectations. No API key, no `claude plugin eval` |

`scripts/run-tests.mjs` already picks up `scripts/*.test.mjs`, so both new test files join `npm test` with no runner change. The hooks stay thin wrappers, the way `guard.sh` wraps `guard.mjs`: the headline hook script only calls `node scripts/manager.mjs headline`.

## Rules for every slice

- Test-first per `tdd`: the red test lands at the slice's seam before the code.
- No API key anywhere: no `--bare`, no `claude plugin eval`. Behaviour is checked with subagent tests in a session.
- CI stays green: `npm test`, `npm run check` (`check-drift.mjs`), `npm run evals:check`.
  - A new skill needs `SKILL.md`, at least 3 evals with both polarities, `npm run evals:build` output committed, and the README skills badge bumped.
  - A change to `hooks/hooks.json` or `guard.mjs` needs `npm run harness:manifest`.
  - A new top-level config key needs its row in `workflows/README.md`.
- No third-party dependency (spec D1). `manager.mjs` and `config-merge.mjs` use Node built-ins only, like `render-logs.mjs`.
- Each slice adds its `CHANGELOG.md` lines under "Unreleased".

## Vertical slices (smallest first)

### Slice 0 · Setup re-run shows a diff (stories 1)

**The user sees:** `/grimoire:setup` on a configured project lists what it would add, change or keep across the whole setup, then writes only what was approved.

- `scripts/config-merge.mjs` + `scripts/config-merge.test.mjs`. Cases:
  - a missing key is added;
  - an existing key the proposal changes is listed as "change", and is applied only when `--approve <path>` names it;
  - unknown hand-written keys are kept;
  - arrays such as `repos` are matched by `name`;
  - invalid JSON is refused;
  - the merged output is idempotent: running it twice gives no diff.
- `skills/setup/SKILL.md`, a new "Re-run" part of step 0:
  - read the existing `grimoire.config.json`, `.claude/settings.json`, `memory/`, `.claude/agents/`, `AGENTS.md` and `CLAUDE.md`;
  - run `config-merge.mjs` for the JSON files;
  - show one diff;
  - write on a yes;
  - reference secrets, never read them.
- `skills/setup/evals/evals.json`: re-run cases.
  - A configured project where setup must show a diff and not overwrite.
  - A hand-edited `repos[].gate` that must be kept.
  - The existing "already set up → roast" negative case stays.
- **Subagent test:** run the setup skill on a fixture project that already has a config, and check that no file changes before the yes.

**Done when** the config-merge tests pass, the setup evals pass as subagent tests, and CI is green.

### Slice 1 · Briefing on demand for tracker issues (stories 2, 3, 11)

**The user sees:** `/grimoire:manager` writes `.grimoire/manager/briefings/<timestamp>.md` and `latest.md`. Issues are grouped Decide / Do / Hand to AI / Waiting on others / Not now, urgent first, each with a reason, a next step and a link, and new or changed items are badged.

- **WorkItem schema:** `skills/manager/workitem.schema.json`. The scouts' output contract, read by `manager.mjs`.
- **`scripts/manager.mjs brief` + `scripts/manager.test.mjs`.** Cases:
  - **Urgency:** each of the four rules alone, at and just past each threshold, with a fixed `--now`.
  - **Order:** urgent, then priority (unknown last), then due date, then oldest created, then id.
  - **Buckets:** taken from the fields. A `bucketHint` never makes an item urgent.
  - **Badges:** new, changed and resolved, against a previous ledger. A first run is labelled "first briefing".
  - **Capped and failed sources:** a source at `maxItemsPerSource` shows "≥ N". A source that failed shows under "Not checked" with its fix.
  - **Ledger:** a corrupt or old-`schemaVersion` ledger resets the badges and doesn't crash.
  - **Escaping:** titles carrying Markdown or HTML are escaped.
  - **Lock:** a fresh lock refuses a second run, and a lock older than 30 min is broken.
  - **GitHub priority:** `priorityLabels` maps labels to priorities.
- **`skills/manager/SKILL.md`:**
  - read `manager.sources`;
  - dispatch `tracker-scout` per tracker source with the schema;
  - collect the WorkItems into a temp file;
  - run `manager.mjs brief`;
  - show the result.
  - Falls back to `toolHints.tracker` when `manager` isn't configured yet, and says so.
- **`agents/tracker-scout.md`:** reaches MCP tools (its `tools:` line widened, or dropped and given `memory/agents/tracker-scout.md` per `check-drift.mjs:87-96`), and returns WorkItems when the brief asks for them. Verify, with a subagent test, that the scout actually sees the session's claude.ai connectors (spec D5). If it doesn't, the skill reads through the main session and records why.
- **Guard rule (`hooks/scripts/guard.mjs` + `hooks/hooks.json` matcher `…|mcp__.*`).** When the agent type (namespace stripped) is in a read-only set (the plugin scouts and the reviewer), an `mcp__*` tool whose name matches the write verbs in spec D5 is denied.
  - **Denied:** a scout's `save_issue`, `create_comment` and `send_message`.
  - **Allowed:** a scout's `list_issues` and `get_issue`; the main session's `save_issue`; a repo agent's MCP call.
  - **Unaffected:** `guard.enabled: false` turns it off.
  - Then run `npm run harness:manifest`.
- **`skills/setup/SKILL.md` manager section:** propose `manager.sources` from the trackers it detects, with the vendor's read-only route, plus `manager.urgent` defaults and `priorityLabels` for GitHub. It goes through slice 0's diff.
- **`grimoire.config.example.json`:** the `manager` block from the spec. `workflows/README.md` gets a row: "not read by the loop".
- **New skill bookkeeping:** `skills/manager/evals/evals.json` (≥ 3 cases: positive "what's urgent?", edge "no manager config yet", negative "build this project" → orchestrate), `npm run evals:build`, the README badge 13 → 14, the commands list in `README.md`, the `plugin.json` description, and `hooks/README.md` for the guard rule.
- **Subagent test:** run `/grimoire:manager` on a fixture project whose source points at the user's tracker through its read-only route, and check that the briefing file exists, is grouped and ranked, and that no tracker write was attempted.

**Done when** the script and guard tests pass, the manager evals pass as subagent tests, a real briefing renders from the team's tracker, and CI is green.

### Slice 2 · PRs and grimoire runs in the briefing (story 4)

**The user sees:** PRs waiting on a review, PRs with failing CI, and approved but unmerged PRs (under Decide or Do), plus halted, stale or needs-attention grimoire runs (under Do).

- **`manager.mjs`, a `runs` source:** `loadRuns` + `runOutcome` from `render-logs.mjs` over `telemetry.dir` give WorkItems of kind `run`. Tests: a halted run, a stale run (no journal write for `STALE_HOURS`), a drained run that is left out, and a missing runs directory, which omits the section.
- **`manager.mjs`, PR WorkItems:** the bucketing rules (review requested → Decide, failing CI → Do, approved and not merged → Do), with tests.
- **`tracker-scout`:** a `prs` source kind read through `gh pr list --json` or GitHub's MCP (`search_pull_requests`), scoped to `manager.sources[].scope.repos`.
- **Setup:** proposes a `prs` source per GitHub remote it finds in `repos[]`, and the `runs` source by default.
- **Subagent test:** the briefing on the fixture project shows a fixture halted run and a real open PR.

**Done when** the tests pass and the PR and run sections appear in a real briefing.

### Slice 3 · Session headline and stale warning (story 5)

**The user sees:** at session start, one line such as `grimoire manager · 2 urgent, 3 ready for AI · briefing 5 h old (/grimoire:manager)`. A stale briefing says so. With no briefing, nothing is shown.

- **`manager.mjs headline`:** reads `latest.md`'s front matter and the ledger. It is stale past the schedule interval, or 24 h without a schedule, and its output is always under 10,000 characters. Tests: fresh, stale, absent, corrupt (silent), first briefing.
- **`hooks/scripts/briefing.sh`:** a thin wrapper that exits 0 on any failure, registered under `SessionStart` in `hooks/hooks.json` next to `first-run.sh`. Then `npm run harness:manifest`, and a row in `hooks/README.md`.

**Done when** the headline tests pass and a new session in the fixture project shows the line.

### Slice 4 · Launch from the briefing (stories 6, 7, 8)

**The user sees:** after the briefing, checkboxes of the issues ready for AI, plus "all ready". Each ticked project opens in its own conversation, or gets a prompt to paste. Issues whose repository isn't available are shown unticked, with the fix.

- **`manager.mjs repos`.** Per `repos[]` entry: the path exists, it is a git work tree, and a submodule is initialised (`git submodule status`, not `-`). Tests run against real temp repos: a plain repo, an uninitialised submodule, a missing path, and a nested repo inside a hub.
- **`manager.mjs launch-plan`.** Ticked ids → one group per tracker project.
  - **Route:** a sliced project goes to `/orchestrate` with its spec, plan and project. A loose ready issue goes to `/implement` → `/review`. Missing acceptance criteria → `/roast` first.
  - **Order:** projects that share a repo are sequenced, and the plan says which waits for which.
  - **Prompts:** one self-contained prompt per project, carrying ids, routes and repo paths, never ticket bodies.
  - Tests cover each route, the overlap ordering, and that ticket text with injected instructions never reaches a prompt.
- **`skills/manager/SKILL.md`, the launch step:**
  - AskUserQuestion multi-select (at most 4 per group, 4 groups, plus "all ready");
  - `manager.mjs repos`, then `launch-plan`;
  - per group, the host's session tool when ToolSearch finds one, else the prompt;
  - offers a repo's fix command, and runs it only on a yes.
- **Evals:** a ticked selection across two projects gives two conversations; an uninitialised submodule is not launched; no session tool gives prompts.
- **Subagent test:** run against a fixture with two projects, one overlapping repo and one uninitialised submodule.

**Done when** the tests pass and a real selection starts one conversation per project (in the desktop app) or prints the prompts.

### Slice 5 · Local schedule (story 9)

**The user sees:** setup offers a daily briefing on this machine. Each scheduled briefing contains the copy-paste prompts, since no one is there to tick.

- **`skills/setup/SKILL.md` schedule step:**
  - prefer a desktop scheduled task when the host has them;
  - otherwise propose a crontab line with `claude -p "/grimoire:manager" --permission-prompts none` (plus `--max-budget-usd` when `budgetUsd` is set), never `--bare`;
  - probe the sources once headless under the user's login, and record `verifiedAt`.
- **`skills/manager/SKILL.md`:** when it can't ask the user (headless), it skips the checkbox step and writes the prompts into the briefing.
- **`manager.mjs brief --headless`:** includes the `launch-plan` prompts for every eligible issue. Tests cover that.

**Done when** a scheduled run produces a briefing with prompts, and the setup probe flags a source that fails headless.

### Slice 6 · Shared post (story 10)

**The user sees:** when enabled at setup, one Linear document, GitHub issue or Slack message that is replaced on each run, with a "generated by · at · covering" line.

- **`manager.mjs share-body`:** renders the post (no badges that depend on one person's ledger), with tests.
- **`skills/manager/SKILL.md`:** the main session publishes through `manager.share.hint` in one narrow step, the only write. A failure is listed in the local briefing and never filed in the tracker.
- **Setup:** a `share` step, opt-in, set to `null` by default.

**Done when** the tests pass and a real post is replaced (not duplicated) across two runs.

### Slice 7 · The HTML briefing page (story 12, spec D12)

**The user sees:** `.grimoire/manager/briefing.html`, written by every briefing run, scheduled ones included. It is one self-contained page: the same groups as the Markdown briefing, with filters (urgent, ready for AI, PRs, runs), checkboxes on the ready-for-AI issues, a disabled row with the fix for an unavailable repo, and **"Copy launch prompt"** for each project. The skill prints its path to open, and the session headline points to it.

- **`scripts/manager.mjs view --json`:** the view model, built by one function that the Markdown, the page and the panel all render from.
- **`scripts/manager.mjs render --html`:** the page, with inline CSS and JS, no external URL, light and dark, and the data embedded so that it can't break out of its script tag.
- **Tests (`scripts/manager.test.mjs`, in the style of `render-logs.test.mjs`, executed against a minimal DOM):**
  - the page is self-contained (no `<script src>` or external URL);
  - a ticket title with `</script>` or HTML is escaped and can't break out;
  - the copied prompt holds ids, routes and repo paths, never ticket bodies;
  - the counts equal `view --json`'s.

**Done when** the tests pass and a real briefing opens as a page in the browser.

### Slice 8 · The inline panel with Launch (story 13, spec D12)

**The user sees:** in the Claude desktop app, the briefing as an interactive panel in the conversation. You tick issues and press **Launch**, and one conversation per project starts. In a terminal, the checkbox fallback and the page's path.

- **`skills/manager/SKILL.md`:**
  - when ToolSearch finds an interactive widget tool, render the panel from `view --json`;
  - the panel's Launch sends `/grimoire:manager launch <ids…>` into the session;
  - on that message, re-check every id against the latest briefing and `manager.mjs repos`, then run slice 4's launch step;
  - unknown or stale ids are refused, with the reason given.
- **`scripts/manager.mjs launch-check <ids…>`:** validates ids against `latest` and returns the launch plan. Tests cover an unknown id, a stale briefing, and an id whose repo became unavailable.
- **Evals:**
  - a launch message with valid ids → conversations started;
  - with an id not in the briefing → refused;
  - with no widget tool → checkbox fallback and the page path.

**Done when** the tests pass and, in the desktop app, ticking and pressing Launch starts one conversation per project.

### Later (own roasts)

- **Signals into the tracker** (App Store, Google Play, Shopify, crash reports).
- **The mail organiser with draft replies.**

Their open questions are in the spec under "Questions still owned by the user".

## Order and dependencies

- Slice 0 comes first. Slice 1's setup section rides on its diff.
- Slices 2, 3 and 6 each depend only on slice 1.
- Slice 4 depends on 1. Slice 5 depends on 1 and 4, because the scheduled briefing carries the launch prompts.
- Slice 7 depends on 1 and 4, because the page carries the launch prompts. Slice 8 depends on 4 and 7, because it shares the view model and launches through slice 4.
- Files that several slices touch: `skills/manager/SKILL.md`, `scripts/manager.mjs` and `skills/setup/SKILL.md`. Slices that run in parallel must coordinate on these, so build them one per repo checkout at a time (`AGENTS.md`).
