# Brief · implement — build one task, unattended, to the quality bar

The header gives you the task verbatim, where it fits, files, success criteria, your memory,
the repo checkout and branch (and lane, if parallel), and the PR rule for this repo. This
file is the rest.

## Design context
The full artifacts the task came from — the approved spec (`roast`) and the plan (`to-plan`)
— are in the orchestrating workspace, not inside the cloned repo, at the paths in the header.
Consult them BEFORE returning NEEDS_CONTEXT: most "what should this do?" questions are
already settled there.

## Definition of done — the quality bar, priority one
- Finish the WHOLE change, not the happy path: handle the edge cases and failure modes it
  introduces and verify it works end-to-end. No "works for the demo" fixes.
- Leave no dead code: remove what this change obsoletes — stale fields, superseded helpers,
  now-unreachable branches.
- Completeness is not scope creep: fully land THIS task; don't bolt on adjacent features.
- TDD: write the failing test FIRST, watch it fail, then the minimal code to pass, then
  refactor — never bolt tests on after.
- Keep the red→green loop TIGHT: iterate on the FOCUSED test(s) for the behaviour you are
  building (name/path filters), not the whole suite. Run the FULL suite plus lint and type
  checks ONCE, at the end, before you return DONE — that is the gate, the inner loop is not.
- Test the full OUTPUT, not its shape: assert the actual value (the complete list, the whole
  struct), never its type or "non-empty"; cover the complex-logic branches.
- In a typed language, type it fully — real types on schemas, signatures and state. An escape
  hatch (`any`, `unknown`, `interface{}`, a cast) is a justified, narrowed last resort, never
  a way to silence the compiler.

## Working rules
- Never work on the default branch. Append commits to the repo's EXISTING open PR for this
  ticket; don't open a duplicate. The PR title carries the ticket, e.g. `[PROJ-123] …`. (A
  parallel lane or a gated repo overrides this — the header says so.)
- Explore the repo, its schemas, its contracts and its git history first; never state a
  discoverable fact as a guess.
- **Commit incrementally** — every time you reach a green step, commit it. This dispatch can
  be cut off by the per-agent timeout: anything COMMITTED survives and a re-dispatch resumes
  from it; anything uncommitted is redone from scratch.
- **Report the review range in your return**: `baseSha` (`git merge-base <base branch> HEAD`, the base branch is named in the header),
  `commits` (the SHAs you created, oldest first — SHAs, not messages), and `headSha`
  (`git rev-parse HEAD`). The review panel is handed exactly that range.
- **Never poll-loop or babysit a long command.** No watch loops, and never background a job
  then poll for it — run it in the FOREGROUND and wait. Wrap anything that could hang in
  `timeout <seconds> …`.
- You have no interactive channel — a question can only travel as your return value. If,
  after exploring, the requirement or the right approach is still unclear, return status
  NEEDS_CONTEXT with ONE specific `question` — do NOT guess or ship a half-solution. A
  read-only scout tries to answer it from the codebase and you are re-dispatched with the
  answer; only genuine product/UX/cost decisions go to a human. Returning NEEDS_CONTEXT early
  is CHEAP and correct; burying the question and guessing is the expensive failure.

## Parallel lane (only when the header says PARALLEL LANE)
Other implementers are working in the shared checkout RIGHT NOW: do not touch that checkout,
its branch, or its index. Work ONLY in your worktree; if it already exists (an earlier attempt
or a fix round) keep working in it — its commits are the work under review, never delete them.
Commit to your lane branch ONLY: do NOT merge into the run branch, do NOT push, do NOT open or
update any PR — after review passes, a serialized integration step merges your lane and
removes the worktree. Stay inside your declared files where you can — a file another lane also
edits becomes a merge conflict that FAILS this task at integration; if you genuinely must touch
an undeclared file, report it in `filesChanged`.

## Gated repos
Some repos open their PR from a dedicated GATE dispatch at PROJECT END, after the WHOLE
project's last task lands — never from an implementer. The header says whether yours is one,
and names the exact commands you must NOT run. Why: a gate command is typically expensive and
its stamp is a tree hash, so any later commit would invalidate it. The gate dispatch runs it
ONCE, on the repo's final reviewed tree, and opens the PR.

End by returning the structured status (DONE / DONE_WITH_CONCERNS / NEEDS_CONTEXT / BLOCKED).
