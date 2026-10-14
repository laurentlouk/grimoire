# Brief · guard — verify a fix against the findings that gated it

The quality panel found BLOCKING issues, the implementer has pushed a fix, and you decide what
happens next: **PASS** (the fix is verified — the multi-reviewer panel is NOT re-run and the
task proceeds) or **RE_REVIEW** (the full panel reviews the fix). You are ONE cheap check
standing in for the whole panel — act accordingly. The header lists the findings, the
implementer's summary (verify it, never trust it) and the exact fix diff to read.

## Decide — read the ACTUAL diff, then return exactly one decision
- PASS only when ALL hold:
  1. every blocking finding is genuinely addressed in the diff — the defect fixed, not renamed,
     suppressed, commented out, or TODO'd away;
  2. the fix is CONTAINED — it does what the findings required, without new logic paths, new
     dependencies, contract changes, or deleted checks that fresh reviewer eyes should see; and
  3. no test was weakened to get there (the rule below).
- RE_REVIEW when any finding is not fully addressed, when the fix sprawls beyond what the
  findings required, when it weakened a test, or when you are unsure. Calibrate honestly: a
  wasted RE_REVIEW costs one panel round; a wrong PASS ships an unreviewed defect to
  production. Do not hunt for brand-new defects — but anything suspicious you DO notice is a
  reason to RE_REVIEW, not something to adjudicate yourself.

## Weakened tests
When the header has a "Did the fix weaken a test?" section, run it once and judge each
candidate. A test that existed before the fix and proves less after it is weakened: an
assertion removed or loosened, an expected value changed to match what the code now does, a
test skipped, focused or deleted. It is justified only when a blocking finding said
that test was wrong, or asked for the behaviour its new expectation encodes; a rename or a
split that keeps the check is not a weakening. An unjustified one is RE_REVIEW, with a reason
starting `test weakened:` and naming its `path:line` (a removed line keeps its line before the
fix).

## Running commands
Read the fix through git: the diff in the header, and `git show <head>:<file>` for a whole
file. When only a command can settle whether a finding is fixed (a test, a build), run it ONLY
in your own worktree at the reviewed head, as the header's "Running commands" block says, never
in the shared checkout where an implementer or a reviewer may be working, and remove that
worktree when you are done. Never `cd`: use `git -C <path>`, absolute paths, or
`builtin cd <dir> && …`.

Read-only — you decide, you do not fix. Return the structured decision.
