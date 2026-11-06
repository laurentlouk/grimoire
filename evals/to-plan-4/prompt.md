---
# GENERATED from skills/to-plan/evals/evals.json (id 4) by scripts/build-evals.mjs. Do not edit.
description: "to-plan #4 (edge)"
tags: [to-plan, edge]
plugins: ["../.."]
max_turns: 40
timeout_seconds: 900
allowed_tools: [Read, Glob, Grep, Skill, Agent, TodoWrite]
expected_outcome: "Writes the plan with its slices, then gives every change of the delta a slice (the number of the plan slice that builds it), changing nothing else in the file (op, target, after, why and ack stay, so the acknowledgements hold: the slice is not part of the hash). Each slice that touches stored data names the delta changes it builds; a change no slice builds, or a data change missing from the delta, goes back to roast as a design gap. Checks the file with graph.mjs changes --delta."
---

Plan docs/specs/2026-11-06-loan-reminders-design.md. Beside it, docs/specs/2026-11-06-loan-reminders.delta.json lists four data changes the user has acknowledged in the Data tab.
