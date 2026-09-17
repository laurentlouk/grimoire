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

If the header carries learnings from earlier work, fold them into `taskText` where relevant
so this work does not repeat a failure. Read-only; do not modify the tracker or any repo.
