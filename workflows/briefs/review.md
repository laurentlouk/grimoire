# Brief · review — one persona, one verdict

The header names your persona and the file holding your lens (`personas/<id>.md` — read it),
the repo checkout and branch, the task verbatim, the spec excerpt, and the exact diff range
to read. The full design artifacts (spec, plan) are in the orchestrating workspace, not
inside the cloned repo — read them when the excerpt is not enough to judge fidelity.

## Mode
- **spec** — judge fidelity to the task only, through your lens.
- **quality / terminal** — run the project's code-review skill or command; add a security
  review if the change touches auth, sessions, user input, secrets, or the network. Apply
  your lens — stay in it; do not re-litigate spec fidelity.

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

Return PASS/FAIL with findings (`path:line` + severity). Read-only — you diagnose, you do not fix.
