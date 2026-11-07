# Brief · hydrate — turn this cycle's ready issues into executable tasks

Fetch the FULL bodies of exactly the issues listed in the header — no others — from your
issue tracker (use its tool or MCP).

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

## The design's delta (only when the header names it)
A design that changes stored data or the architecture has a delta beside its spec: `{ data:
[change], architecture: [change] }`, each change `{id, op, target, why, slice, …}` (an architecture
target is `component:<id>`, `connection:<from>-><to>` or `boundary:<label>`). Copy into each task's
`deltaChanges` the changes of both lists it builds:
those whose `slice` is the task's slice, or that its issue names (`to-issues` lists them), each
`{id, op, target, why}` verbatim, nothing paraphrased; `[]` when none. The implementer builds
them and reports the state of each; the changes of other slices are not its business.

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

The engine escalates a task to opus by itself after repeated fix rounds, and routes a task
replanned after a code failure to opus; you do not need to hedge for that.

## Labels, and a stricter policy when the issue calls for one
Copy each issue's tracker labels into `labels`, verbatim: a `grimoire:policy/<p>` label is the
owner's override of how strictly the task is reviewed.

The engine picks each task's execution policy (fast, balanced, strict) itself, from its declared
files, its repo and its dependencies; you do not classify tasks. Set `policy` (with a one-sentence
`policyReason`) ONLY to propose a STRICTER one than its files would suggest, because the issue
shows a risk they do not: an authorization rule in an ordinary-looking file, money, personal data,
a contract another team consumes. The engine takes the higher of your proposal and its own pick; it
never lowers a task for you. Omit both when you have no such reason.

If the header carries learnings from earlier work, fold them into `taskText` where relevant
so this work does not repeat a failure. Where an issue is silent on something the implementer
will need (a path, a table, an existing helper), look it up in the repo and state it in the
task rather than leaving a gap the implementer must guess at or ask about; report in
`inputProblems` only what neither the artifacts nor the code settle. Read-only; do not modify
the tracker or any repo — except when the header has a CLAIM section: then assign exactly the
listed issues and move them to in-progress, nothing else.

You plan from reading. Do not run builds, test suites, dev servers or browsers to find out
whether something works: that is the implementer's job, inside its own time budget. A hydration
that ran builds and a browser probe to decide whether two tasks could share a repo spent twenty
minutes, and the scheduler held one of them anyway; declaring each task's `files` precisely is
what decides that.

You may hydrate an issue before its blockers land (the loop prefetches the next ones while they
run): state code facts as of now; the implementer re-checks them against the code it starts from.
