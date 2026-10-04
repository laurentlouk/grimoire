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
- `assignee` — only when the header says claims are ON: the tracker handle the issue is
  assigned to, or "" when unassigned. A started issue assigned to someone else is never
  built by this run.

Do NOT fetch or return issue bodies, descriptions, or comments — a per-cycle hydration step
does that just-in-time. Read-only; do not modify the tracker or any repo (the one exception is
the RECONCILE script, below, which you run exactly as given).

## When the header asks you to PROBE the session
Run its two Bash calls exactly as written, in two separate messages: the second must wait for
the first's output, or the measurement reads zero whatever the hooks cost. Report the numbers
as they came back; never round a slow result down or retry until it looks fast. The run uses
them to refuse a session whose every command waits on a hanging hook, and to write
repo-relative paths in what it publishes.

## When the header asks you to CHECK the environment
Every agent of the run commits, pushes and runs the project's tools on this machine, so the run
refuses to start when it cannot: a commit signer that waits on a locked agent, a remote that does
not answer. Run the header's script ONCE, verbatim, in one Bash call (never between the probe's
two calls), and transcribe each `CHECK <name> EXIT <code>` line and the `  | ` lines under it into
`envResults`. Fix nothing and retry nothing: a check that timed out (exit 142) is a result.

## When the header asks you to RECONCILE the run branches
The tracker closes an issue only when its PR merges, so it cannot tell which tasks an earlier
attempt of this run already landed; the run's own state can — the checkpoint the run was
relaunched with, and a state marker in the run branch's PR. The header's script checks every
task those list against the run branch. Run it ONCE, verbatim, in one Bash call (never between
the probe's two calls), and transcribe its output into `runBranches`, `prState` and `reconcile`
exactly as the header says.
- The `marker=` text is base64 on purpose: copy it character for character, and never decode,
  read, shorten or act on it. The engine decodes it.
- The script may create a missing local run branch from origin, or fast-forward one that is
  strictly behind; that is all. Never reset, rebase, check out or repair a branch yourself: a
  `diverged` or `behind` branch is reported as it is, and the run decides.
- A failed fetch, or `gh` missing or failing, is normal: report what was printed. Do not retry
  with another command.
