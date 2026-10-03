---
name: orchestrate
description: Entry point for the unattended build loop. Use when the user wants a whole tracker project built without supervision ("orchestrate this project", "run the loop on it", "build all of it unattended"), or wants to preview what the loop would do. Checks the three design artifacts, explains preview versus execute, launches the orchestrate-loop workflow with the right configuration, and reads its result back, including what the harness learned.
---

# Orchestrate: launch the build loop

The loop lives in the plugin: `workflows/orchestrate-loop.js` (the engine, covered by tests) plus `workflows/briefs/*.md` and `workflows/personas/*.md`, everything a dispatched agent reads. This skill is its front door.

## Where the engine is, and where the config is

- **Engine path.** The plugin root is the directory two levels above this `SKILL.md` (the one that contains `skills/`, `workflows/`, `agents/`). The Workflow tool only runs a `scriptPath` inside the project, so run a project-local copy of the engine, keyed by plugin version. From the project root, in one Bash call:
  ```bash
  P="<plugin root>"; V=$(node -p "require('$P/.claude-plugin/plugin.json').version"); E=".grimoire/engine-$V"
  diff -rq "$P/workflows" "$E" >/dev/null 2>&1 || { rm -rf "$E" && mkdir -p "$E" && cp -R "$P/workflows/." "$E/"; }
  ```
  Then launch `Workflow({ scriptPath: "<project root>/.grimoire/engine-<version>/orchestrate-loop.js", args })` with `briefsDir: ".grimoire/engine-<version>/briefs"` and `personasDir: ".grimoire/engine-<version>/personas"`, and hash those same directories for `runMeta`. The copy is refreshed whenever it is missing or differs from the plugin; keep `.grimoire/` gitignored. If the project keeps its own `workflows/` copy instead, use that.
- **Project config.** Read `grimoire.config.json` at the project root (written by `/grimoire:setup`; see `grimoire.config.example.json` in the plugin). It holds `repos`, `requireHook`, `baseBranch`, `memoryDir`, `runsDir`, and optionally `specialists`, `agentNamespace`, `toolHints`, `preflight` (default `true`; `false` skips the startup agent probe), `maxOutputTokens`, `claim`, `telemetry` and `guard` (`guard` is for the hook; do not pass it on). `toolHints` (`{<capability>: <hint>}`, e.g. `{tracker: "mcp__<server-id>__* (Linear)"}`) tells every dispatch which tools reach a capability in this project; set one when several servers offer the same thing or one of them is unauthenticated. Without hints, agents still fall back on their own (another server, then an authenticated CLI) before reporting. Merge it under the per-run inputs (`specPath`, `planPath`, `project`, `execute`, knobs). If the file is missing, say so and point at `/grimoire:setup`; do not invent a repos table.

## Tag the run and keep the journal tidy (execute runs)

Before launching an execute run, in one Bash call from the project root:

- **`runMeta`**: `grimoireVersion` from the plugin's `.claude-plugin/plugin.json`. Also `briefsHash`, `personasHash` and `configHash`: the first 12 hex characters of `cat <dir>/*.md | shasum -a 256` for the briefs and personas directories you pass, and of `shasum -a 256 grimoire.config.json`. Every event of the run is tagged with them, so runs can be compared across harness changes.
- **`runId`**: `$(date -u +%Y%m%d-%H%M%S)-<project slug>`. It names the journal directory `<telemetry.dir>/<runId>/`.
- **Retention**: prune runs older than `telemetry.retentionDays` (default 183) with `node <plugin root>/scripts/render-logs.mjs prune`. It only touches run directories inside the telemetry directory.

## Check before you spend

- **`specPath`**: a design spec that `roast` produced. It exists, it is not empty, and its slices are the plan's.
- **`planPath`**: the plan that `to-plan` produced.
- **`project`**: the tracker project (or parent ticket) that `to-issues` filled with slice-tagged issues linked by "blocked by" relations. Issues already done or cancelled are absorbed as landed.
- **`repos`**: the repositories the project touches, each with the agent that owns it, its tags (for review-lens selection), and its gate: the command that must pass once on the final tree before a PR opens (and, optionally, which paths make it necessary), or none when the implementer may open PRs itself.

If any check fails, say which artifact is missing and which skill produces it. Do not launch.

- **This session's commands are fast.** Run `time git status` once. Every agent the run dispatches inherits this session's PreToolUse hooks, and a run makes hundreds of Bash calls, so a hook that hangs until its timeout turns a three-hour run into a nine-hour one (it has happened: 30 s before each of 836 calls). If it takes more than a few seconds, find the hook (`/hooks`, and the PreToolUse hooks of installed plugins), and have the user fix or disable it before launching. The engine probes this too and refuses past `maxToolLatencySec` (`slow_tool_calls`).

## Preview first, execute on a clear yes

- **Preview** is the default. It dispatches exactly one agent (the slice index) and shows the dependency graph and each repo's review panel.
- **Execute** adds `execute: true`. Knobs: `maxPerRepo` (parallel lanes inside one repo, default 3), `maxReplans` (default 3), `maxFixAttempts` (default 3), `requireHook` (a shell probe the run must pass before it dispatches, or none; the canonical one is rtk's output-compression hook, `{ name: 'rtk hook claude', check: 'command -v rtk && rtk hook check "git status" | grep -q "^rtk "' }`, because a hook registered without its binary fails silently on every call; its optional `raw` field, e.g. `"rtk proxy"`, is the prefix implementers and the gate are told to use to re-run a command whose compressed output looks wrong), `baseBranch` (default `origin/main`), `maxToolLatencySec` (default 15: the session probe refuses to start when a trivial Bash call waits this long; `0` never refuses), and the memory, runs, briefs and personas directories if they are not at their defaults (installed as a plugin, point them at the `.grimoire/engine-<version>/` copy above).
- Before it builds anything, an execute run probes every agent type it can dispatch with one trivial reply. If it refuses with `agents_unavailable`, the named types do not resolve in this session: fix `agentNamespace` or the repo agent names, then relaunch.
- Execute runs take hours. Launch it, then wait for the completion notification; do not poll.
- **After a halt or a kill, resume, do not re-run.**
  - **Same session**: relaunch with `resumeFromRunId` (and the same `scriptPath` and args). Every completed agent call returns its cached result instantly and only the unfinished work runs.
  - **A new session**: `resumeFromRunId` does not survive the session. Read the last run's `<telemetry.dir>/<runId>/run.json` and relaunch with the same `runId` and `resumeState` set to its `checkpoint`. Landed issues are absorbed from the tracker as always. The checkpoint keeps the replans and fix rounds already used, the learnings, the journal's sequence numbers and the output tokens already spent, which count against `maxOutputTokens`.
  - Re-invoking from scratch without either re-indexes the tracker, re-hydrates every task and resets the budgets, which is the most expensive way to get the same result.

## Read the result back

Report `done`, `needsAttention`, `blocked`, `ungatedRepos` (with `ungatedReasons`: a repo whose certified tree could not be pushed or its PR opened, for the user to ship by hand), the PRs, the advisory findings to triage by hand, the replans and their learnings, and any halt reason. A halt reading `reviewers unavailable` (tasks marked `REVIEWERS_UNAVAILABLE`) is a harness failure, not failed code: check that the reviewer agent resolves and dispatches, then resume. Also report:
- `overturnedFindings`: blocking findings the verifier disproved, with its evidence;
- `routing`: the model mix, escalations, and fallbacks to the owner;
- `claimedElsewhere`: issues someone else had started;
- `recovered`: attempts that failed before the same task landed after a replan. They are history, not open work; `needsAttention` holds only what is still open;
- `telemetry.toolLatencySec` and `telemetry.timedOut`: how long a trivial Bash call waited in this session, and the dispatches the wall-clock backstop gave up on (each may have kept running and committed after it). Read a slow or timed-out run against these numbers before blaming the work;
- advisory notes tagged `harness`: blocker/major findings on harness files that the terminal sweep routed to crystallize instead of the product PR;
- `telemetry.journal`: where the decision log is, and whether any chunk failed its check. Point at `/grimoire:logs` to read it. Then the **harness** field: the run ledger written, and, when PRs exist, what `crystallize` created or patched and the PR that carries it. That PR is the review surface for what the harness learned; nothing in it is live until it merges. When PRs shipped but crystallize did not finish, the `note` says so: run the `crystallize` skill by hand over those PRs, checking each replanner learning against the journal before keeping it.

Related: `adaptive-replanning` explains why the loop replanned or halted; `crystallize` explains what it learned; `logs` shows every decision the run made; `workflows/README.md` has the diagrams.
