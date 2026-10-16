# Manager briefing: design

**Status:** proposed, awaiting approval · **Date:** 2026-10-16 · **Input:** [the landscape research](../research/2026-10-16-manager-po-landscape.md)

## Problem

The team runs AI work through grimoire, but nothing tells them what deserves attention or what to hand to AI next. Urgent tickets, stalled work, PRs waiting on a review and halted loop runs all go unnoticed until someone remembers to look. Grimoire reads the tracker only to build a project it was given (`workflows/briefs/index.md`). Nothing ranks issues, and the loop's issue schema has no priority field (`workflows/orchestrate-loop.js:273`).

## Goals (v1)

- `/grimoire:manager` produces a **briefing**: tracker issues, open PRs and grimoire runs, grouped by what the team owes, ranked by rules anyone can read.
- From the briefing, the user ticks issues and launches them: one conversation per tracker project, routed to the loop or to supervised implement → review.
- It runs on demand and on a local schedule. Every session starts with a one-line headline from the last briefing.
- It is tool-agnostic. Sources are bound at setup, and setup can be re-run to update them, as can the rest of the configuration.

## Non-goals (v1)

- Filing signals from App Store, Google Play, Shopify or crash trackers into the tracker. That is slice 6, with its own roast.
- The mail organiser with draft replies. That is slice 7, with its own roast.
- Changing tracker state on its own: no labels, comments, priorities or transitions. The one write is the opt-in shared post (D6).
- Dispatching AI work without a human ticking it.
- Running in the cloud or in CI (D9).

## Decisions

Each decision gives the alternative rejected and why.

**D1 · Dependency policy (owner).**
- No third-party open-source project is a runtime dependency: no obsei, himalaya, community MCP servers, n8n or similar.
- We copy code only from permissively licensed projects (MIT, Apache-2.0, BSD), adapted to grimoire, with attribution in a `THIRD_PARTY.md` entry beside the code. Apache-2.0 also needs its `NOTICE` text carried along.
- AGPL, GPL, unlicensed and source-available projects are **principle only**: no code is copied.
- The services' **own official tools are allowed**: Linear's MCP, Atlassian's MCP, the `gh` CLI and GitHub's MCP, and claude.ai connectors. Grimoire ships no API client for them.
- *Rejected:* adopting the best existing tool per area (fastest, but the team doesn't want third-party dependencies), and writing our own clients for every tracker (much more scope, and we would own auth and API churn).

**D2 · Order of work (owner).** The tracker briefing ships first. Signals come later (slice 6), then email (slice 7), and the whole setup re-run comes before any of it (slice 0). *Rejected:* signals first (the first write path, with dedupe needed on day one), email first (the most sensitive), and all four thin (every part half-built).

**D3 · Shape: a skill, read-only scouts, a deterministic script.**
- `/grimoire:manager` runs in the main session, which is the orchestrator (`AGENTS.md`).
- Each source is read by a read-only scout that returns `WorkItem`s against a JSON schema. `tracker-scout` reads issues and PRs.
- `scripts/manager.mjs` does everything that is not judgment: urgency rules, ranking, grouping, the diff against the ledger, rendering, and the headline. It has tests, following `scripts/render-logs.mjs`.
- Facts come from code and judgment from the model. The model decides the bucket where that needs reading, such as "is this waiting on us or on them?", and gives each item's one-line next step.
- *Rejected:* one agent doing everything in prose (ranking drifts between runs and can't be tested), and a long-running daemon (grimoire has none, and the user rejected cloud and CI for v1).

**D4 · Binding sources to tools.**
- `manager.sources[]` names each source by category (`tracker`, `prs`, `runs`) and kind (`linear`, `jira`, `github`). Its `hint` uses the same format as `toolHints`. It also records the scope and how read-only is enforced (`endpoint`, `flag`, `admin-group`, `permission-rule`, or `guard` for a claude.ai connector, which only the guard's MCP rule holds read-only).
- Scouts use the existing tool fallback (`orchestrate-loop.js:681`): configured hint → another connector via ToolSearch → an authenticated CLI → report.
- Setup proposes the vendor's read-only route where one exists: Linear `/mcp/readonly`, GitHub `/x/issues/readonly` or `--read-only`, a read-only API key.
- *Rejected:* a normalised connector layer in code (D1 rules out the products, and Symphony's spec warns against generic CRUD), and hard-coding tool names (connector ids are opaque and differ per account).

**D5 · Read-only by construction, not by prompt.**
- **Scouts are blocked from tracker writes by the guard hook.** Plugin agents can't list connector tool names they don't know, and a plugin can't ship permission rules. So `hooks/scripts/guard.mjs` gains a rule: a plugin scout (`agent_type` in the roster's read-only set) may not call an `mcp__*` tool whose name reads as a write.
  - **How a name is read** (settled while building ODY-869, 2026-10-16). The tool part after the last `__` is split into words on `_`, `-` and camelCase boundaries. The **first word that is a known verb decides**:
    - a read verb allows the call: `get`, `list`, `search`, `read`, `fetch`, `find`, `query`, `view`, `show`, `describe`, `count`, `aggregate`, `lookup`, `check`, `status`, `inspect`, `analyze`, `explain`, `export`, `download`;
    - a write verb denies it: `save`, `create`, `update`, `delete`, `send`, `reply`, `forward`, `merge`, `set`, `add`, `remove`, `mark`, `share`, `unshare`, `submit`, `resolve`, `retire`, `restore`, `trash`, `untrash`, `label`, `unlabel`, `respond`, `archive`, `unarchive`, `assign`, `move`, `upload`, `publish`, `post`, `edit`, `write`, `patch`, `put`, `insert`, `upsert`, `apply`, `approve`, `decline`, `cancel`, `close`, `reopen`, `comment`, `schedule`, `invite`, `transfer`, `buy`, `purchase`, `pay`, `deploy`, `rollback`, `promote`, `revoke`, `rename`, `change`, `modify`, `toggle`, `enable`, `disable`, `exec`, `execute`, `run`, `invoke`, `pause`, `unpause`, `stop`, `kill`, `start`, `restart`, `reset`, `clear`, `purge`, `activate`, `deactivate`, `invalidate`, `accept`, `reject`, `grant`, `attach`, `detach`, `link`, `unlink`, `subscribe`, `unsubscribe`, `import`, `sync`, `stage`, `record`, `generate` (the second batch was added after running 134 real connector tool names through the rule);
    - a name with no known verb is allowed (the guard fails open).
  - **Examples:** `slack_send_message` and `createJiraIssue` are denied; `get_label`, `list_saved_views` and `forwarding_rules_list` are allowed.
  - **Rejected alternative:** matching only a verb prefix (the first draft). It misses vendor-prefixed names such as `slack_send_message`, camelCase names, and verbs it doesn't list.
- **The guard hook's matcher grows** to include `mcp__.*`.
- **`tracker-scout` gets MCP access.** Today its `tools: Read, Bash, WebFetch` cannot reach a tracker MCP at all, and nothing dispatches it, which is why that never surfaced. Its `tools:` line is dropped or widened so it inherits the session's tools, with the guard rule as the boundary. If it is dropped, it gets the `memory/agents/tracker-scout.md` file that `check-drift.mjs:87-96` then requires.
- **The only write in v1 is the opt-in shared post**, made by the main session in one narrow step.
- *Rejected:* trusting the prompt alone (the research's strongest projects all make "read-only" structural), and a `permissions.deny` list (setup can propose one, but it can't name unknown tool ids, and plugins can't ship it).

**D6 · Where the briefing lands (owner).**
- **Always:** `.grimoire/manager/briefings/<timestamp>.md`, plus `latest.md`, plus the visual page `briefing.html` (D12), plus a one-line headline injected by the existing `SessionStart` hook as `additionalContext`. It is plain text, no model call, under 10,000 characters.
- **Opt-in at setup:** one shared post (a Linear document, a GitHub issue or a Slack message). Each run replaces it, so there is one rolling post with a "generated by · at · covering" line.
- *Rejected:* local only (the team never shares a view), shared only (every run writes to a shared tool, and the headline has nothing to read), and an HTML page (no headline, not shared).

**D7 · What is urgent, and how the briefing is ranked (owner).**
- **An item is urgent when any of these holds:**
  - tracker priority Urgent or High, or an SLA at risk or breached;
  - overdue, or due within 2 days;
  - not started and blocking 2 or more open issues;
  - in progress with no activity for 5 days.

  Every threshold is configurable in `manager.urgent`.
- **The briefing is grouped by what the team owes:**
  - **Decide**: triage, an unassigned urgent issue, a PR review requested.
  - **Do**: urgent work, a PR with failing CI, an approved PR not merged, a halted run.
  - **Hand to AI**: D8.
  - **Waiting on others**.
  - **Not now**.
- **Sort order:** urgent first, then tracker priority (unknown priority last), then due date, then the oldest created, then the id.
- **Every item shows** why it is there, its next step and a link. "New" and "changed" badges come from the ledger.
- GitHub has no priority field, so setup maps priority labels (`manager.priorityLabels`).
- *Rejected:* a model-scored urgency (can't be tested, and changes run to run).

**D8 · Handing work to AI (owner).**
- **An issue is eligible when:**
  - it has acceptance criteria;
  - nothing open blocks it;
  - it has no assignee, or the assignee is `claim.identity`;
  - no PR is linked to it;
  - it is not a parent issue;
  - it maps to a `repos[]` entry: first through `manager.repoLabels` (tracker label → repo name, proposed by setup from the tracker's label descriptions), then the same way the loop's index does;
  - that repo is available: `repos[].path` exists and is a git work tree, and if it is a submodule, it has been initialised.
- **An unavailable repo** leaves the issue unticked, with the reason and the fix (`git submodule update --init <path>`). The fix runs only on a yes.
- **In a session**, the briefing offers the eligible issues as checkboxes (AskUserQuestion multi-select, at most 4 per group and 4 groups, plus "all ready"). It launches what is ticked:
  - **Grouping:** one new conversation per tracker project.
  - **Route:** an issue in a sliced project (spec + plan + `to-issues`) goes to `/orchestrate` on that project. A loose ready issue goes to supervised `/implement` → `/review`. An issue without acceptance criteria gets a suggestion to `/roast` first.
- **The conversation is started** with the host's session tool when one exists (the desktop app has one). Otherwise each project gets a self-contained prompt to paste into a new conversation.
- **Two projects that share a repo run one after the other**, never in parallel: grimoire never puts two agents on one checkout (`AGENTS.md`), and a worktree of a hub doesn't contain its nested repos or submodules. The briefing says which one waits.
- **A scheduled run**, which can't ask anything, writes the copy-paste prompts into the briefing.
- *Rejected:* a batch mode in the loop for loose issues (an engine change, deferred), and automatic dispatch (spends budget and opens PRs without asking).

**D9 · Triggers (owner).**
- **On demand:** `/grimoire:manager`.
- **Optional local schedule:** a desktop scheduled task when the host has them (the Claude desktop app exposes a scheduled-tasks tool, so setup creates it through that tool), else cron running `claude -p "/grimoire:manager"` with `--max-budget-usd` and `--permission-prompts none`.
- **No API key, ever (owner, 2026-10-16).** Scheduled runs never use `--bare`, which requires `ANTHROPIC_API_KEY`. They run under the user's own Claude login. Tests follow the same rule: plain node tests in CI, and behaviour checks run as subagents inside a session, never `claude plugin eval` or an API-key run.
- **Stale warning:** the session headline says when the latest briefing is older than the schedule interval, or older than 24 h without a schedule.
- *Rejected:* a cloud routine (a fresh clone every run, so the ledger has no home, and no local CLIs) and a GitHub Actions cron (GitHub-centric, needs an API-key secret). Both stay possible later, once the ledger has a durable home.

**D10 · State.**
- `.grimoire/manager/`, already gitignored (`.gitignore:3`), holds:
  - `ledger.json`: `schemaVersion`; per source `lastRunAt` and `lastStatus`; per item `firstSeenAt`, `lastHash` and `lastBucket`;
  - `briefings/`;
  - `latest.md`;
  - `.lock`.
- v1 reads the **current state** of each scope every run, with no delta cursor, so a lost or corrupt ledger only resets the "new" badges.
- The item hash covers state, priority, assignee, due date, blockers, labels and PR status.
- *Rejected:* an incremental cursor (needed for signals in slice 6, not for a snapshot), and committing the ledger (per-machine noise in git).

**D11 · The setup re-run, whole setup first (owner).** Slice 0:
- On a re-run, `/grimoire:setup` reads the existing `grimoire.config.json`, `.claude/settings.json`, memory, agents and `CLAUDE.md`.
- It shows one diff of what it would add, change or leave alone, and writes only what is approved.
- Keys the user edited by hand are kept, and secrets are referenced, never read into context.
- The manager section (sources, schedule, shared post, urgency thresholds) then plugs into the same detect → diff → write → probe flow. The probe is one read per source, also run headless when a schedule is chosen, so a source that only works interactively is flagged at setup.
- *Rejected:* a re-run for the manager section only (two re-run behaviours), and leaving setup alone (the user wants re-runs as updates).

**D12 · A visual to review and execute (owner, 2026-10-16, raised during the build).**
- **One view model.** `scripts/manager.mjs view --json` builds the briefing's view model once: the groups, the items with their reasons and next steps, the counts, the ready-for-AI list with its repo checks, and the launch plan per project. Every visual renders from it, so they never disagree, the way `/grimoire:logs` and its `summary` share one function.
- **The HTML page, everywhere.** `.grimoire/manager/briefing.html` is self-contained, like `/grimoire:logs` and `/grimoire:graph`: inline CSS and JS, no external URL, light and dark.
  - It is written by every briefing run, including scheduled ones. The skill prints its path to open, and the session headline points to it.
  - On the page you can review, filter (urgent, ready for AI, PRs, runs) and tick. **"Copy launch prompt"** copies one prompt per project for the ticked issues.
  - A static page can't start Claude, so executing from it is always a paste.
  - Ticket text is escaped, and embedded data can't break out of its script tag (the same guarantee `render-logs.mjs` tests).
- **The inline panel, in the Claude desktop app.** When the host offers an interactive widget tool (found with ToolSearch, e.g. the desktop app's visualize tool), the skill shows the briefing as an inline panel.
  - The panel has the same groups and checkboxes, a disabled row with the fix for an unavailable repo, and a **Launch** button.
  - Launch sends `/grimoire:manager launch <ids…>` into the session. The skill then re-checks every id against the latest briefing and the repo check, and only then runs the launch step from D8: one conversation per project, or the prompts.
  - The message carries ids only, never ticket text, so a hostile ticket can't become a command.
- **Fallback.** Without a widget tool (a terminal session), the skill keeps the AskUserQuestion checkboxes and gives the page's path.
- *Rejected:*
  - **The HTML page only:** executing is always a paste, even in the app that could launch directly.
  - **The panel only:** nothing visual outside the desktop app.
  - **A local server behind the page with a Launch button:** a running process, plus a localhost endpoint able to start agents, is a cross-site request risk to design around, for one click saved.

**D13 · Aligned with the tools the team actually uses (audit, 2026-10-16).** Checked against the four projects that run grimoire (`odyyy-orchestrator`, `website`, `lab`, `iDeaLex`) and the tools this machine and session have.
- **Trackers.**
  - **Linear** (team Odyyy) is used by the hub, through the claude.ai connector, so its `readOnly` is `guard`.
  - **GitHub Issues** through the authenticated `gh` CLI is used by the three single-repo projects.
  - **Jira** is supported by the design but used by none, so it stays untested against a real workspace.
- **Repo mapping.** Odyyy's Linear labels name the repos: `webapp` → `webapp`, `backend` → `odyyy-backend`, `infra` → `cloud`, and **`frontend` → `odyyy-app`, the Expo mobile app, not the web app**. A judgment-only match can misroute that, so `manager.repoLabels` is explicit, proposed by setup from the label descriptions, and used before judgment.
- **GitHub priority.** None of the three GitHub repos has a priority label, so every issue would read as unknown priority.
  - Setup offers to create `priority: urgent`, `priority: high`, `priority: medium` and `priority: low`, with `gh label create`, only on the user's yes.
  - The default `priorityLabels` recognises those names plus `P0`–`P3` and `critical`.
- **Hub layout.** The hub's repos are independent clones under `repositories/`, gitignored, with no submodules, alongside extra working clones (e.g. `odyyy-app-level-up`) that are not in `repos[]`. The availability check treats a path as available when it exists and is a git work tree, and setup may record `repos[].remote`, so the fix for a missing clone can name its URL. Extra clones are ignored.
- **Host tools the later slices rely on, all present in the desktop app:** the visualize tool (D12 panel), the session-starting tool (D8), the scheduled-tasks tool (D9), and the Slack and Linear document connectors plus `gh` for the shared post (D6).
- **Runtime:** Node 24 (≥ 20 required) and Claude Code 2.1.270 (`--permission-prompts none` needs ≥ 2.1.259).
- **Not in this machine's tools,** so the later signal and email slices must say what they use instead: no App Store Connect tool (D1 rules out third-party CLIs), and no Linear, Jira or `asc` CLI. Available for those slices: Sentry, PostHog and Vercel connectors, and Gmail and Calendar connectors.
- **Shipping.** The marketplace serves grimoire 0.11.0. These features reach the four projects when a version that includes them is released and each project runs `/plugin update grimoire@grimoire`, then `/grimoire:setup` to add its `manager` block.

## The `WorkItem` (scout output, validated by the script)

- **Identity:** `sourceId`, `id`, `key`, `title`, `url`.
- **Kind:** `issue`, `pr` or `run`.
- **State:** `stateType` (`triage | backlog | unstarted | started | completed | canceled`) plus `nativeState`.
- **Priority:** 0–4 on Linear's scale, plus `nativePriority`.
- **People and dates:** `assignee`, `dueAt`, `createdAt`, `updatedAt`, `lastActivityAt`.
- **Links:** `blockedBy[]`, `blocks[]`, `parentOf[]`, `project` (with `sliced: bool`), `repo` (the `repos[]` name, or null).
- **Signals:** `slaAt`, `hasAcceptanceCriteria`, `linkedPr`, `labels[]`.
- **Model's reading:** `bucketHint`, `nextStep`.

This is inspired by Symphony's issue model and Linear's importer types. The script never trusts `bucketHint` for urgency: urgency is computed from the fields.

## Config (added to `grimoire.config.example.json`, documented in `workflows/README.md` as "not read by the loop")

```json
"manager": {
  "sources": [
    { "id": "linear", "category": "tracker", "kind": "linear", "hint": "mcp__<server-id>__* (Linear, the claude.ai connector)", "readOnly": "guard", "scope": { "teams": ["ENG"] } },
    { "id": "prs", "category": "prs", "kind": "github", "hint": "gh CLI, authenticated", "readOnly": "permission-rule", "scope": { "repos": ["acme/api", "acme/app"] } },
    { "id": "runs", "category": "runs", "kind": "grimoire" }
  ],
  "urgent": { "priorityAtMost": 2, "dueWithinDays": 2, "blocksAtLeast": 2, "stalledDays": 5 },
  "priorityLabels": { "priority: urgent": 1, "priority: high": 2, "priority: medium": 3, "priority: low": 4, "P0": 1, "P1": 2, "P2": 3, "P3": 4, "critical": 1 },
  "repoLabels": { "webapp": "webapp", "backend": "odyyy-backend", "frontend": "odyyy-app", "infra": "cloud" },
  "maxItemsPerSource": 200,
  "schedule": { "kind": "desktop-task", "when": "weekdays 08:30" },
  "share": null,
  "budgetUsd": null
}
```

## Vertical slices (smallest first)

0. **Setup re-run** (whole setup): detect, then diff, then write only what is approved, plus the probe. New setup evals cover a re-run on a project that is already configured.
1. **Briefing on demand.**
   - Adds the `manager` skill, the `scripts/manager.mjs` rank, diff and render functions with their tests, and the `WorkItem` schema.
   - `tracker-scout` gets MCP access, and the guard gets its MCP write rule.
   - Setup gains a manager section.
   - The output is the local briefing for tracker issues.
2. **PRs and runs** in the briefing: PRs through `gh` or GitHub's MCP; runs through `render-logs.mjs summary --json`.
3. **Session headline and stale warning** in `first-run.sh`'s `SessionStart` hook, or a sibling hook.
4. **Launch from the briefing:** checkboxes, the repo-availability check, one conversation per project, routing by readiness, overlapping repos queued, the copy-paste fallback.
5. **Local schedule:** a desktop task or cron with `claude -p`, set up and probed by setup, and copy-paste prompts in scheduled briefings.
6. **Shared post** (opt-in): one rolling post per destination.
7. **The HTML briefing page** (D12): the `view --json` model, `briefing.html`, "Copy launch prompt" per project.
8. **The inline panel with Launch** (D12): the widget in the desktop app, plus `/grimoire:manager launch <ids>`, which re-checks the ids before launching.
- *Later, own roast:* signals into the tracker.
- *Later, own roast:* the mail organiser with draft replies.

## Edge cases and failure modes

- **A source is unreachable or its auth expired.** The briefing still renders, with a "Not checked: linear (auth expired), fix: …" section, and the headline says "partial". A source is never silently skipped.
- **Two runs at once** (the schedule plus a manual run, two sessions). The second run sees `.grimoire/manager/.lock` and says a briefing is in progress. A lock older than 30 min is broken, using the same stale-lock approach as the loop.
- **Large workspaces.** Each source is scoped at setup and capped at `maxItemsPerSource`. Every query fetches the items that meet the urgency criteria first, then the rest. A capped count shows as "≥ N" and is never presented as complete.
- **First run.** Everything is new. The headline says "first briefing" instead of announcing N new urgent items.
- **Items gone since the last briefing.** Closed or deleted items are counted as "resolved since last briefing" and are not listed.
- **Time.** "Due within 2 days" and "stalled 5 days" are computed by the script from one `now`, in the machine's time zone, with dates printed in ISO format.
- **Hostile ticket and PR text.** Scouts return it as data and never act on it. Titles are escaped in the briefing. Launch prompts carry ids, never bodies: the launched conversation reads the ticket itself through its own scouts.
- **Selection bigger than the picker.** "All ready" covers everything eligible, and the full list sits in the briefing with one prompt per project.
- **A repo that is not checked out**, or a submodule that has not been initialised. Shown as not launchable, with the fix. The fix runs only on a yes, never on its own.
- **A headless run without connectors.** The setup probe catches it before a schedule is written. At run time the source shows as not checked.
- **Several teammates.** Each person's ledger and briefing are local. The shared post is replaced by whichever run is newest, and says who generated it and when.
- **A shared post that fails.** The local briefing is still written, and the failure is listed in it. The tracker never receives an issue about the manager's own failure.
- **Plugin updates.** The ledger's `schemaVersion` changes, so the ledger is rebuilt and the badges reset. Nothing crashes.
- **Cost.** Scouts run on haiku. A scheduled run uses `--max-budget-usd` when `budgetUsd` is set (setup proposes a value, and it is the user's call).

## Questions still owned by the user

- **At setup:** the shared destination, the schedule time, and the budget value.
- **Slice 6 roast:**
  - which signal sources come first;
  - whether trusted signals are filed straight into the tracker's Triage or stay proposals;
  - App Store Connect has no official MCP or CLI, so under D1 grimoire would need its own small client, adapted from MIT code or written from the principle.
- **Slice 7 roast:**
  - the mail providers;
  - Google's Gmail MCP is official but in preview, and IMAP has no official tool, so it would need grimoire's own client under D1;
  - the approval surface beyond the provider's Drafts folder.
- **The name:** `/grimoire:manager` is the working name.

## Sources consulted

- **Docs:** `README.md`, `AGENTS.md`, `memory/README.md`, `hooks/README.md`, `workflows/README.md` (inputs, the config table), `skills/setup/SKILL.md`, `skills/orchestrate/SKILL.md`, `skills/implement/SKILL.md`, `workflows/briefs/index.md`, `.harness/README.md`.
- **Scouts:**
  - a codebase scout on how grimoire reaches the tracker today;
  - a codebase scout on CI, evals, hooks, logs, setup re-runs and the harness policy;
  - a Claude Code docs scout on subagent tools, permissions, scheduling, headless runs, hooks and channels;
  - four landscape searches (the research doc).
- **Code that settled questions:**
  - `orchestrate-loop.js:273` (no priority field), `:681` (the tool fallback), `:2727-2740` (`claim` and `toolHints` parsing);
  - `agents/tracker-scout.md:4` (no MCP access);
  - `hooks/hooks.json` and `guard.mjs:23-33` (the matcher excludes MCP);
  - `scripts/check-drift.mjs:87-96` (memory rule), `:100-115` (skill evals), `:219-228` (config keys);
  - `scripts/render-logs.mjs` (`summary --json`, `.grimoire/` layout);
  - `.gitignore:3`.

## Self-answered questions (veto any)

| Question | Answer | Source |
| --- | --- | --- |
| Does grimoire already have tracker code to reuse? | No. Agents resolve tools at runtime from hints plus a fallback | scout; `orchestrate-loop.js:681` |
| Can a plugin ship deny rules or schedules? | No, so read-only is enforced through the guard hook, and schedules are a setup step | Claude Code docs (plugins/components, scheduled-tasks) |
| Can hooks watch sources? | No. No hook fires on a timer or a webhook. `SessionStart` can inject up to 10k characters | Claude Code docs (hooks) |
| How does the loop map an issue to a repo? | By the index agent's judgment against `repos[]` names. The manager does the same | `workflows/briefs/index.md` |
| Can the loop take loose issues? | No. It needs a spec, a plan and a sliced project | `skills/orchestrate/SKILL.md` "Check before you spend" |
| Can two loop runs share a checkout? | Not safely. One agent per checkout, so overlapping projects are queued | `AGENTS.md`; a per-repo ship lock only (`orchestrate-loop.js:1673`) |
| Where should state live? | `.grimoire/manager/`, which is already gitignored | `.gitignore:3`; `render-logs.mjs` layout |
| What does a new skill or agent need to pass CI? | Skill: `SKILL.md`, at least 3 evals of both polarities, generated `evals/`, the README badge. Agent: frontmatter, an `AGENTS.md` row, and a memory file if it writes | `check-drift.mjs`; `build-evals.mjs` |
| Is a new config key checked? | The example's top-level keys must appear in `workflows/README.md`, so `manager` gets a "not read by the loop" row like `guard` and `graph` | `check-drift.mjs:219-228` |
| Does a subagent see the session's claude.ai connectors? | Yes, when its definition has no `tools:` line: a probe on 2026-10-16 loaded the Linear connector's tools with ToolSearch and read real issues. So `tracker-scout` drops `tools:` and gets a memory file, and the guard's MCP rule keeps it read-only | in-session probe (ODY-871 prep) |
| Does the hooks change need the harness manifest regenerated? | Yes. `hooks/hooks.json` and `guard.mjs` are in its scope (`npm run harness:manifest`) | `harness-manifest.mjs:10` |

## Docs drift fixed

| Document | Said | Code does | Fixed |
| --- | --- | --- | --- |
| `AGENTS.md:76`, `:79` | a new agent needs its evals, and the drift check fails without them | `check-drift.mjs` checks an agent's definition, its roster row and its memory file. Evals exist for skills only (`build-evals.mjs` reads `skills/*/evals`) | `AGENTS.md`, in this change |

Also found, not drift but a code gap fixed in slice 1: `agents/tracker-scout.md` says it reads "through the tracker's tool", but its `tools:` line cannot reach an MCP tool.

## Reference projects (pattern adopted · not adopted)

Licence status was checked on GitHub on 2026-10-16. Copying code follows D1.

| Project | Pattern adopted | Not adopted |
| --- | --- | --- |
| [openai/symphony](https://github.com/openai/symphony) (Apache-2.0, 27.7k★) | The small read kernel, native and normalised state side by side, an eligibility predicate with a stable sort | Its daemon, its tracker adapters, auto-dispatch |
| [github/gh-aw](https://github.com/github/gh-aw) (MIT, 5.4k★) | A rolling report that replaces the previous one, writes capped and checked against a schema, an explicit "nothing to do" | The Actions runtime and its compiled workflows |
| [google-gemini/gemini-cli](https://github.com/google-gemini/gemini-cli) triage (Apache-2.0, 107k★) | Deterministic queries pick the candidates, and the model only fills the gaps | Label writes, the GitHub-only taxonomy |
| [anthropics/claude-code-action](https://github.com/anthropics/claude-code-action) (MIT, 9.5k★) | A narrow set of verbs, lifecycle timers in code rather than in the model | Label-only triage writes |
| [anthropics/knowledge-work-plugins](https://github.com/anthropics/knowledge-work-plugins) (Apache-2.0, 29.9k★) | Categories bound to concrete servers at setup | One-way placeholder rewriting |
| [linear/linear](https://github.com/linear/linear) importer (MIT, official) | The five state types and the 0–4 priority scale | Its import pipeline |
| [crmne/copilot-triage](https://github.com/crmne/copilot-triage) (MIT, 16★, below the roast's credibility bar, idea only) | Grouping by what the human owes, priority that only rises, silence as a valid outcome | Its Ruby tool layer, Projects-board writes |
| [microsoft/hve-core](https://github.com/microsoft/hve-core) (MIT, 1.5k★) | A manager with no write tools, "inactivity is a signal, not a disposition" | Per-platform executors (v1 has no writes) |
