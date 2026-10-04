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
- **Pre-existing failures are not yours.** Before attributing a failing check, lint or test
  to your change (in a build or a fix round), run it on the base: in a throwaway worktree of
  your `baseSha` (`git worktree add --detach <tmp dir> <baseSha>`, run the same command there,
  then `git worktree remove --force <tmp dir>`), or compare with the base branch's own CI
  result — never `git stash` or a checkout in your working tree, which can lose work. Red on
  the base too: report it in `concerns` as pre-existing (the command and the failing names)
  and do not fix unrelated failures. Red only with your change: it is yours to fix.
- Test the full OUTPUT, not its shape: assert the actual value (the complete list, the whole
  struct), never its type or "non-empty"; cover the complex-logic branches.
- In a typed language, type it fully — real types on schemas, signatures and state. An escape
  hatch (`any`, `unknown`, `interface{}`, a cast) is a justified, narrowed last resort, never
  a way to silence the compiler.

## Working rules
- Never work on the default branch. Work on the branch the header names: every task of a
  repo in one run lands on its ONE run branch, so when the header says RUN BRANCH, check that
  branch out and commit there — never start a branch of your own (it would never be
  integrated).
- **Never push, never open or update a PR.** The loop ships what you commit: once a task has
  passed its review it pushes the landed head and keeps the repo's one draft PR up to date (or,
  for a repo set to deliver at the end, pushes once, at PROJECT END), and the repo's terminal
  slot marks the PR ready at PROJECT END. You commit; the loop ships.
- **Explore before asking; don't guess.** If a fact is discoverable in the design artifacts,
  the docs, the code, schemas, contracts, config or git history, find it yourself before
  asking, and never state a discoverable fact as a guess. Only decisions the owner holds
  (product/UX calls, cost or vendor trade-offs, priorities, context outside the codebase) may
  leave as a question. When exploration is inconclusive, your NEEDS_CONTEXT question says
  what you checked and what is still unknown.
- **Commit incrementally** — every time you reach a green step, commit it. This dispatch is
  not cut off at its time limit; it is waited for. Commit at every green step so a later
  session can absorb it: anything COMMITTED survives, anything uncommitted is redone from
  scratch.
- **Report the review range in your return**: `baseSha` (`git merge-base <base branch> HEAD`, the base branch is named in the header),
  `startSha` (`git rev-parse HEAD` on your branch BEFORE your first change — for a merge or
  integration task, the branch head before you merged), `commits` (the SHAs you created,
  oldest first — SHAs, not messages), and `headSha` (`git rev-parse HEAD`). The review panel
  is handed exactly `startSha..headSha`, so a merge brings in only what it adds to the branch.
- **Never poll-loop or babysit a long command.** No watch loops, and never background a job
  then poll for it — run it in the FOREGROUND and wait. Wrap anything that could hang (a browser
  engine, a device, a network call) in a time limit: `timeout <s> …`, or `gtimeout <s> …`, and
  where neither exists (stock macOS has no `timeout`) `perl -e 'alarm shift; exec @ARGV' <s> …`
  (exit 142 = timed out). Check which one exists before relying on it: a wrapper that is "command
  not found" guards nothing.
- **Shell: never `cd`.** It may be aliased or replaced by a shell plugin's function (one such
  replacement once made 147 commands of a run fail). Use `git -C <path>` and absolute paths, or `builtin cd` when
  a tool must run from a directory. Read and search files with the Read and Grep tools rather than
  `cat`, `head` or `grep` in Bash.
- You have no interactive channel — a question can only travel as your return value. If,
  after exploring, the requirement or the right approach is still unclear, return status
  NEEDS_CONTEXT with ONE specific `question` — do NOT guess or ship a half-solution. A
  read-only scout tries to answer it from the codebase and you are re-dispatched with the
  answer; only genuine product/UX/cost decisions go to a human. Returning NEEDS_CONTEXT early
  is CHEAP and correct; burying the question and guessing is the expensive failure.

## Already done when you start
If HEAD already holds this task's work — an earlier attempt, or a predecessor that ran past its
time limit, committed it — do not redo, regenerate or re-commit it. Verify it against the
success criteria with the focused checks, then return DONE (DONE_PENDING_GATE in a gated repo)
with `commits: []`, `startSha = headSha = HEAD`, and `landedBefore` = the SHAs that implement it,
oldest first (`git log --reverse --format=%H <baseSha>..HEAD -- <declared files>`, keeping only
this task's commits). The loop absorbs those SHAs if a panel already passed them, and otherwise
reviews them as they stand: an empty diff is never a defect when you name them. If only part of
the task is there, finish the rest as a normal change (its commits in `commits`) and leave
`landedBefore` out.

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
Some repos have a gate command that certifies the tree before the PR opens. It runs in the
terminal slot at PROJECT END, after the WHOLE project's last task lands — never from an
implementer. The header says whether yours is one, and names the exact command you must NOT
run. Why: a gate command is typically expensive and its stamp is a tree hash, so any later
commit would invalidate it. The terminal slot runs it ONCE, on the repo's final reviewed
tree, then pushes and opens the PR. When your task is done, return DONE_PENDING_GATE: it lands
exactly like DONE. Keep DONE_WITH_CONCERNS for a real concern.

End by returning the structured status (DONE / DONE_WITH_CONCERNS / NEEDS_CONTEXT / BLOCKED;
in a gated repo, DONE_PENDING_GATE instead of DONE — the gate still to run is not a concern).
