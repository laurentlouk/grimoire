# Brief · index — verify the design artifacts, return the slice index

You are indexing the inputs of an automated BUILD run. The header names its three design
artifacts: the approved spec (`roast`), the plan (`to-plan`), the slice-tagged project in
your issue tracker (`to-issues`), plus the repos this run may touch.

## First, VERIFY the artifacts — the run refuses to start on a bad one
Check that the spec and plan both exist and are non-empty, and that the project resolves in
the tracker to issues carrying slice tags. If ANY check fails, return `slices: []` and report
each failure in `inputProblems` (name the artifact and the fix, e.g. "planPath:
docs/plans/x.md does not exist — run to-plan first"). NEVER invent an index from partial
inputs.

## Then return the SLICE INDEX — lightweight, NO issue bodies
Using your tracker's tool or MCP (Jira, Linear, GitHub Issues, or whatever this project
uses), list ALL slice-tagged issues for the project — the WHOLE project, however many slices
it has. Return every slice in ascending order with its `slice` number and `sliceLabel` (the
value statement), and per issue ONLY:
- `id` (the tracker identifier, e.g. PROJ-123) and `title`
- `repo` — the owning repo, matched to one of the names in the header
- `dependsOn` — the tracker ids of the issues that BLOCK it (its "blocked by" relations).
  This schedules the whole run: an issue executes as soon as everything it depends on has
  landed, so get these links right and complete.
- `state`, bucketed: done (Done / Completed / Merged / Released / Closed-as-done) · canceled
  (Canceled / Won't do / Duplicate) · started (In Progress / In Review) · todo (anything
  else). done/canceled issues are absorbed — counted as landed dependencies, never
  re-implemented.

Do NOT fetch or return issue bodies, descriptions, or comments — a per-cycle hydration step
does that just-in-time. Read-only; do not modify the tracker or any repo.
