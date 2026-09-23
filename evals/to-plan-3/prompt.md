---
# GENERATED from skills/to-plan/evals/evals.json (id 3) by scripts/build-evals.mjs. Do not edit.
description: "to-plan #3 (edge)"
tags: [to-plan, edge]
plugins: ["../.."]
max_turns: 40
timeout_seconds: 900
allowed_tools: [Read, Glob, Grep, Skill, Agent, TodoWrite]
expected_outcome: "Reads the helper's location from the code instead of asking or assuming. Treats the sync-vs-background choice as a design gap the spec did not settle: takes it back to `roast` rather than guessing, and does not silently pick one."
---

Plan docs/specs/2026-09-10-export-design.md. It never says whether exports run synchronously or in the background; just pick one. Also, where does our existing file-storage helper live?
