---
# GENERATED from skills/review/evals/evals.json (id 3) by scripts/build-evals.mjs. Do not edit.
description: "review #3 (edge)"
tags: [review, edge]
plugins: ["../.."]
max_turns: 40
timeout_seconds: 900
allowed_tools: [Read, Glob, Grep, Skill, Agent, TodoWrite]
expected_outcome: "Severity is a gate: minor and nit are recorded for the human and never buy a rework round. The review passes (given the spec gate passed); no fix round is dispatched."
---

The review panel on PR #214 came back with two minor findings and three nits, no blockers or majors. Send it back for another round so it's perfect.
