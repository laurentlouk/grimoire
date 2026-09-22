---
name: roast
description: Stress-test a plan or design before any code is written. Use it to scope a feature, decide how to approach something, or pressure-test an existing plan. It answers its own questions from the docs and the code first (code is the source of truth, and drifted docs get fixed), borrows best practice from credible open-source projects when the codebase has no precedent, and asks you only the decisions that are genuinely yours.
---

# Roast the design

Interrogate the plan until you and the user genuinely agree on it. Walk every branch of the design, and settle the decisions that depend on each other one at a time. Ask one question per message and wait for the answer before the next one; never send a batch. For each question, say what you would recommend rather than leaving it open.

Be a sparring partner, not a rubber stamp. Push on odd boundaries and data flows, drag unstated assumptions into the open, offer real alternatives, and go looking for the edge cases the idea has not handled yet: concurrency, partial failure, idempotency, going offline and reconnecting, event ordering and replay, pagination, migration and rollback, load at the scale the product is aiming for. Think in vertical slices, the smallest end-to-end pieces that each deliver something a user can see, smallest first. Do not touch code or hand the work off until the design is approved.

## Start from what is already known

If the project keeps harness memory (a `memory/` or `.claude/memory/` store of curated facts) it is already in your context; read the latest related specs, plans and post-PR learning reports too. Never re-derive what is written down.

## Recon in two lanes at once, and let the code win

Run both lanes together, in one fan-out:

- **Docs lane.** The project's README, `docs/`, ADRs, runbooks, API contract comments, and any previous spec on the topic.
- **Code lane.** How it actually works today: the code, schemas, contracts, config, git history, and the patterns the project follows. Use read-only scouts when the search is wide.

Then diff the two. The code is the source of truth. Where a document contradicts the code, record a *docs-drift* item (what the doc says, what the code does, file and line for both) and do not bend the design toward the stale document. Fixing that document is part of this roast's deliverable: update it alongside the spec, or hand the fix to the implementer if it lives elsewhere. A design built on a document that lied is the most expensive roast failure there is. The one exception is a document that is openly a forward-looking spec; mark it as such instead of rewriting it.

## Answer your own question before you ask it

Explore before asking; don't guess. If a fact is discoverable in the docs, the code, schemas, contracts, config or git history, find it yourself before asking, and never state a discoverable fact as a guess. Ask only decisions the user owns: product/UX calls, cost or vendor trade-offs, priorities, context outside the codebase. When exploration is inconclusive, say what you checked and what is still unknown, then ask. Every question climbs this ladder, and only the top rung reaches the user:

1. Is it in the docs or the memory? Answer it and cite the file.
2. Is it in the code, schema, contract, config, deployed infra or history? Find it, or send a scout, and cite the location.
3. Is it a "how do serious projects do this" question with no precedent in this codebase? Look outward (next section).
4. What remains is a product or UX call, a cost or vendor trade-off, a priority, context that lives outside the codebase, or something that looks wrong and needs the owner's confirmation. Ask that, one question per message, with your recommendation.

List the questions you answered yourself in the spec so the user can veto any of them.

## No precedent? Borrow the pattern, never the stack

When neither the docs nor the code shows how to do something, look at how large, maintained open-source projects that use the same technologies solve it. Only credible sources count: widely adopted repositories (roughly two thousand stars or more, or an official vendor project), active in the last year, with a known license. Read the actual code path, not the README's claim. Then map the pattern onto this codebase and write down explicitly what you are *not* adopting. The stack and the architecture are fixed inputs to a roast, never its output: a reference tells you *how*, not *with what*. A `reference-scout` agent exists for exactly this if the project ships one.

## The spec

Write the approved design to a short spec, for example `docs/specs/YYYY-MM-DD-topic-design.md`, with: the problem, goals and non-goals; numbered decisions, each with the alternative rejected and why; the vertical slices; edge cases and failure modes; the questions still owned by the user. Add three short sections that make the roast auditable: **Sources consulted** (docs read, scouts sent, code that settled a question), **Self-answered questions** (question, answer, source), **Docs drift fixed** (document, what it said, what the code does, where it was fixed), and **Reference projects** if any (repository, path, pattern adopted, what was deliberately not adopted).

## Loop, do not run once

When planning or building later surfaces a design question the spec did not settle, come back here, roast the gap, update the spec, and revise the plan. Leave the loop only when it stops producing new design questions. Then pass the spec to `to-plan`.
