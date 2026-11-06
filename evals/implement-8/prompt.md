---
# GENERATED from skills/implement/evals/evals.json (id 8) by scripts/build-evals.mjs. Do not edit.
description: "implement #8 (edge)"
tags: [implement, edge]
plugins: ["../.."]
max_turns: 40
timeout_seconds: 900
allowed_tools: [Read, Glob, Grep, Skill, Agent, TodoWrite]
expected_outcome: "The implementer's brief carries the issue's planned changes and the delta's path; before returning it ran graph_changes with the delta and reported deltaStates and modelChanges. Neither unplanned change blocks or becomes a question for the user: the kept index has its reason, the reverted column says why. As the delta's single writer in a session, it appends the kept index to the delta as an unplanned change (origin unplanned, the reason as why, its slice, never acknowledged), adds a Data model and architecture changes section to the PR description (planned ✓ / pending / built differently, unplanned ⚠ kept or reverted with reasons), and tells the user in one message so they can acknowledge it in the Data tab, without waiting for an answer."
---

Implement LOANS-3 (slice 2 of the loans plan; the design's delta is docs/specs/2026-11-06-loans.delta.json). The implementer reports it also added an index on loans.due that the delta does not plan, and that it reverted a column it had dropped by mistake.
