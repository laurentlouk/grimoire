---
name: review
description: Review an implemented issue with an independent, diverse-lens panel. Use after implement to gate a PR on spec fidelity and production quality before it merges, routing fixes back to the implementer and re-reviewing until it passes.
---

# Review the implementation

Review the diff against its issue with an independent reviewer (never the implementer), in two gates.

**Spec gate.** One reviewer, the spec hawk: does the diff do exactly what the issue says, nothing missing, nothing smuggled in, happy path working end to end?

**Quality gate.** A panel of lenses run in parallel, each applied only to the repositories it fits and each failing only on blocker or major findings: reliability and release readiness (hot paths, query patterns, backpressure, backwards compatibility, deploy ordering); eventing and data integrity (idempotency, ordering and replay, migration drift); adversarial QA (races, offline, forged input, abuse vectors, plus dead code the change left behind); human interface craft; accessibility; privacy and hard authorization; store or platform compliance where the product ships through one. The lenses live in `workflows/personas/`; reuse them here.

**Before the panel, a precheck.** Confirm there is something to review: a commit range, a non-empty diff, no conflict or stub markers added, tests moved with the behaviour. If any check fails, send it back before paying for reviewers. The loop does this with a cheap agent (`workflows/briefs/precheck.md`).

Severity is a gate. Blocker and major send the work back; minor and nit are recorded for the human and never buy a rework round. A FAIL names at least one finding with `path:line`. "Fix everything" from the user does not change that: minors ride along with the next round a major already bought, or go to a ticket, never a round of their own.

**Verify a blocking finding before it buys a fix.** Check each blocker or major against the code. Overturn a finding only with a cited counter-fact (the check it says is missing is at `path:line`), and report the overturned ones rather than dropping them. The loop does this with a verifier (`workflows/briefs/verify.md`). A reviewer whose findings keep being overturned is a lens for `crystallize` to recalibrate.

Route every failing finding back to the implementer and re-review, bounded: three fix rounds per change, in the unattended loop (per stage, with a cheap guard deciding whether the whole panel must re-run) and in a session alike. In a session, count every source of findings on the PR against the same three: a re-review, a bot, a PR review, a later panel. At the cap, stop and hand the remaining findings to the user with what each would cost, rather than starting a fourth round. Re-review only the lens that failed, not the whole panel again, unless the fix touched what another lens judged. Always end on a review. Never start the repo's gate on a head that is still under review: gate the head that passed.

**A fix must not weaken a test.** On every re-review, read the fix's own diff (the head before the fix to the head after it), not only the whole change: a test the change added and a fix then loosened looks, in the whole diff, like one weak test that was always there. A test that existed before the fix and proves less after it (an assertion removed or loosened, an expected value changed to match what the code now does, a test skipped, focused or deleted) is a blocker, unless a finding said that test was wrong or asked for the behaviour its new expectation encodes. The loop does this with a fact sheet of the fix diff (`workflows/briefs/guard.md`).

On PASS the PR is ready once every review thread on it, from bots and humans alike, has an explicit resolution (fixed with a commit, tracked with a ticket, or declined with a reason). Then merge per your merge policy. **Next:** `crystallize`, so the harness learns from the PR and its threads, then ship.
