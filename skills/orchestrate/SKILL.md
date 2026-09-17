---
name: orchestrate
description: Entry point for the unattended build loop. Use when the user wants a whole tracker project built without supervision ("orchestrate this project", "run the loop on it", "build all of it unattended"), or wants to preview what the loop would do. Checks the three design artifacts, explains preview versus execute, launches the orchestrate-loop workflow with the right configuration, and reads its result back, including what the harness learned.
---

# Orchestrate: launch the build loop

The loop lives in the plugin: `workflows/orchestrate-loop.js` (the engine, covered by tests) plus `workflows/briefs/*.md` and `workflows/personas/*.md`, everything a dispatched agent reads. This skill is its front door.

## Where the engine is, and where the config is

- **Engine path.** The plugin root is the directory two levels above this `SKILL.md` (the one that contains `skills/`, `workflows/`, `agents/`). Launch the workflow by path, never by name: `Workflow({ scriptPath: "<plugin root>/workflows/orchestrate-loop.js", args })`, and pass `briefsDir: "<plugin root>/workflows/briefs"` and `personasDir: "<plugin root>/workflows/personas"`. If the project copied `workflows/` locally instead, use that copy.
- **Project config.** Read `grimoire.config.json` at the project root (written by `/grimoire:setup`; see `grimoire.config.example.json` in the plugin). It holds `repos`, `requireHook`, `baseBranch`, `memoryDir`, `runsDir`. Merge it under the per-run inputs (`specPath`, `planPath`, `project`, `execute`, knobs). If the file is missing, say so and point at `/grimoire:setup`; do not invent a repos table.

## Check before you spend

- **`specPath`**: a design spec that `roast` produced. It exists, it is not empty, and its slices are the plan's.
- **`planPath`**: the plan that `to-plan` produced.
- **`project`**: the tracker project (or parent ticket) that `to-issues` filled with slice-tagged issues linked by "blocked by" relations. Issues already done or cancelled are absorbed as landed.
- **`repos`**: the repositories the project touches, each with the agent that owns it, its tags (for review-lens selection), and its gate: the command that must pass once on the final tree before a PR opens (and, optionally, which paths make it necessary), or none when the implementer may open PRs itself.

If any check fails, say which artifact is missing and which skill produces it. Do not launch.

## Preview first, execute on a clear yes

- **Preview** is the default. It dispatches exactly one agent (the slice index) and shows the dependency graph and each repo's review panel.
- **Execute** adds `execute: true`. Knobs: `maxPerRepo` (parallel lanes inside one repo, default 3), `maxReplans` (default 3), `maxFixAttempts` (default 3), `requireHook` (a shell probe the run must pass before it dispatches, or none; the canonical one is rtk's output-compression hook, `{ name: 'rtk hook claude', check: 'command -v rtk && rtk hook check "git status" | grep -q "^rtk "' }`, because a hook registered without its binary fails silently on every call), `baseBranch` (default `origin/main`), and the memory, runs, briefs and personas directories if they are not at their defaults (installed as a plugin, the briefs and personas are under `${CLAUDE_PLUGIN_ROOT}/workflows/`).
- Execute runs take hours. Launch it, then wait for the completion notification; do not poll.
- **After a halt or a kill, resume, do not re-run.** Relaunch with `resumeFromRunId` (and the same `scriptPath` and args): every completed agent call returns its cached result instantly and only the unfinished work runs. Re-invoking the project from scratch re-indexes the tracker and re-hydrates every task, which is the most expensive way to get the same result.

## Read the result back

Report `done`, `needsAttention`, `blocked`, `ungatedRepos`, the PRs, the advisory findings to triage by hand, the replans and their learnings, and any halt reason. Then the **harness** field: the run ledger written, and, when PRs exist, what `crystallize` created or patched and the PR that carries it. That PR is the review surface for what the harness learned; nothing in it is live until it merges.

Related: `adaptive-replanning` explains why the loop replanned or halted; `crystallize` explains what it learned; `workflows/README.md` has the diagrams.
