---
name: review
description: Review an implemented issue with an independent, diverse-lens panel. Use after implement to gate a PR on spec fidelity and production quality before it merges, routing fixes back to the implementer and re-reviewing until it passes.
---

# Review the implementation

Review the diff against its issue with an independent reviewer (never the implementer), in two gates.

**Spec gate.** One reviewer, the spec hawk: does the diff do exactly what the issue says, nothing missing, nothing smuggled in, happy path working end to end?

**Quality gate.** A panel of lenses run in parallel, each applied only to the repositories it fits and each failing only on blocker or major findings: reliability and release readiness (hot paths, query patterns, backpressure, backwards compatibility, deploy ordering); eventing and data integrity (idempotency, ordering and replay, migration drift); adversarial QA (races, offline, forged input, abuse vectors, plus dead code the change left behind); human interface craft; accessibility; privacy and hard authorization; store or platform compliance where the product ships through one. The lenses live in `workflows/personas/`; reuse them here.

Severity is a gate. Blocker and major send the work back; minor and nit are recorded for the human and never buy a rework round. A FAIL names at least one finding with `path:line`.

Route every failing finding back to the implementer and re-review, bounded (the unattended loop allows three fix rounds per stage and uses a cheap guard to decide whether the whole panel must re-run). Always end on a review.

On PASS the PR is ready once every review thread on it, from bots and humans alike, has an explicit resolution (fixed with a commit, tracked with a ticket, or declined with a reason). Then merge per your merge policy. **Next:** `crystallize`, so the harness learns from the PR and its threads, then ship.
