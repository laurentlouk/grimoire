# Brief · hydrate — turn this cycle's ready issues into executable tasks

Fetch the FULL bodies of exactly the issues listed in the header — no others — from your
issue tracker (see "Which tracker tools" below).

For each issue return one task. Set `id` to the tracker identifier EXACTLY as listed (e.g.
PROJ-123) — NEVER a plan-style slice.task number like 1.1; the scheduler matches on it — and
repeat it in `ticket`. Then: the owning repo and its agent (both from the table in the
header), the FULL issue body verbatim (`taskText`), the files it touches, success criteria,
its `slice`/`sliceLabel` as listed, `order` (topological position within its repo), and
`dependsOn` (the tracker ids blocking it). Read the plan and the spec ALONGSIDE the issues:
take each task's `specExcerpt` from the ACTUAL spec/plan text, not from the issue's
paraphrase, and report a contradiction between an issue and the plan/spec in `inputProblems`
instead of silently picking a side.

Declaring `files` well is what buys parallelism: tasks whose declared files are disjoint run
concurrently in their own worktree lanes, while a task with no declared files runs alone in
its repo. Be specific and complete.

Deploy-ordering language in an issue ("the service must ship before the client", "blocked
until X is deployed") constrains MERGE ORDER, never the build: this run stops at PRs, so
BUILD such an issue anyway — test it at its own seams (mocks, local services, or the
dependency's landed run branch) — and carry the ordering constraint into `successCriteria`
so the PR body states it loudly. Do NOT defer for it. Set `deferred=true` (with
`deferredReason`) ONLY when the issue's own acceptance criteria are impossible to satisfy
unattended even against local or mocked dependencies (a store submission, a manual
third-party step). An acceptance demo that would be MORE convincing against a deployed
dependency is a concern to report with DONE_WITH_CONCERNS, not a deferral.

## Route each task: agent × model (you are the selector)
You already read every issue in full, so you also decide who builds it and on which tier.
Set `agent`, `model` and a one-sentence `routeReason` naming the deciding signal.

- **agent** — the repo's owner (the header's table) by default. Pick one of that repo's
  listed specialists only when the task is squarely its kind, as the table describes it. Never
  name an agent the table does not list for that repo: the engine replaces it with the owner.
- **model** — the cheapest tier that will get it right first time; a fix round costs more
  than the tier difference.
  - `haiku`: mechanical and fully specified — a rename, a config value, a copy change, one
    more case in an existing, well-tested pattern. One or two files, no design decision.
  - `sonnet`: a normal feature or fix inside established patterns, a handful of files, with
    tests to write, where the issue and the code settle every decision.
  - `opus`: cross-module or cross-repo design, concurrency, data migrations, security- or
    privacy-sensitive paths, public contracts, code with no tests around it, or anything a
    learning in the header says failed before.
  - Unsure between two tiers: take the higher one.

The engine escalates a task to opus by itself after repeated fix rounds, and routes every
replanned task to opus; you do not need to hedge for that.

If the header carries learnings from earlier work, fold them into `taskText` where relevant
so this work does not repeat a failure. Where an issue is silent on something the implementer
will need (a path, a table, an existing helper), look it up in the repo and state it in the
task rather than leaving a gap the implementer must guess at or ask about; report in
`inputProblems` only what neither the artifacts nor the code settle. Read-only; do not modify
the tracker or any repo — except when the header has a CLAIM section: then assign exactly the
listed issues and move them to in-progress, nothing else.

## Which tracker tools
If the header has a **Tracker tools** section, use exactly those tools. Otherwise prefer an
authenticated connector over a server picked by its name; if a server reports that it needs
authentication, search for the other tracker tools available (ToolSearch, by the tracker's
name) and use one that works. Only when none works is it a problem to report.
