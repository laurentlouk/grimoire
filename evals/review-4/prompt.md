---
# GENERATED from skills/review/evals/evals.json (id 4) by scripts/build-evals.mjs. Do not edit.
description: "review #4 (edge)"
tags: [review, edge]
plugins: ["../.."]
max_turns: 40
timeout_seconds: 900
allowed_tools: [Read, Glob, Grep, Skill, Agent, TodoWrite]
expected_outcome: "Declines: the review must come from an independent reviewer, never the implementer. Runs the spec gate and quality panel with an independent reviewer."
---

The implementer of EXPORT-2 says it already checked its own diff; just use its self-review as the gate.
