# Brief · review — one persona, one verdict

The header names your persona and the file holding your lens (`personas/<id>.md` — read it),
the repo checkout and branch, the task verbatim, the spec excerpt, and the exact diff range
to read. The full design artifacts (spec, plan) are in the orchestrating workspace, not
inside the cloned repo — read them when the excerpt is not enough to judge fidelity.

## Mode
- **spec** — judge fidelity to the task only, through your lens. You read; you do not re-run
  the full build or test suite — the quality stage and the repo's gate run them. Run a
  targeted command only when a requirement can be checked no other way (a count, an exit code,
  one test), and name it in your summary.
- **quality / terminal** — run the project's code-review skill or command; add a security
  review if the change touches auth, sessions, user input, secrets, or the network. Apply
  your lens — stay in it; do not re-litigate spec fidelity.

## Running commands
Read through git: the diff in the header, and `git show <head>:<file>` for a whole file. A
build, a test, a linter, or a review command that executes anything runs ONLY in your own
worktree at the reviewed head — the header's "Running commands" block gives the
`git worktree add --detach` that creates it and the repo's lane setup — never in the shared
checkout. Reviewers run side by side, and two of them building in one checkout once emptied
each other's build output. Remove your worktree when you are done, pass or fail.

Never `cd`: it may be aliased or replaced by a shell plugin's function (one such
replacement once made 147 commands of a run fail). Use `git -C <path>` and absolute paths, or `builtin cd <dir> && …`
when a command must run from a directory. Read and search files with the Read and Grep tools
rather than in Bash. Wrap a command that could hang in a time limit: `timeout <s> …` or
`gtimeout <s> …`, and where neither exists (stock macOS) `perl -e 'alarm shift; exec @ARGV' <s> …`
(exit 142 = timed out).

## Severity is a GATE — calibrate it honestly
Only **blocker** and **major** stop this task and send it back for rework. Reserve them for
something actually wrong: broken behaviour, a missed failure mode, a security or privacy hole,
a violated invariant, dead code the change left behind, a spec requirement with no
implementation. **minor** and **nit** are for polish — naming, wording, style, nice-to-haves.
They are recorded and reported to the human and do NOT trigger a rework round. Do not inflate
a nit into a major to force a fix: a rework round costs a full implementation dispatch, and
spending one on a naming preference is pure waste. Equally, do not soften a genuine blocker to
be agreeable.

A FAIL must carry at least one blocker/major finding naming `path:line` — a FAIL with no
actionable finding cannot be acted on and is treated as gating anyway, so be specific.

## Terminal sweep: read by lens
In the terminal stage the subject is the whole integrated branch. Do not read it in full: take
the `--stat` first, then read only the files your persona's Scope section names. Five reviewers
each reading the entire branch was the largest single input cost of a run, for verdicts that
never depended on the files outside their scope.

## Harness files in the terminal sweep
A blocker or major on a harness file (the loop's `grimoire.config.json`, `.claude/`, agent
rosters, memory, run ledgers) is still worth reporting, but the run routes it to the harness
PR instead of fixing it on the product branch. Report it as usual; do not raise its severity to
force a product fix.

Return PASS/FAIL with findings (`path:line` + severity), with `path` repo-relative, as `git
diff` prints it — never an absolute local path. Read-only — you diagnose, you do not fix.
