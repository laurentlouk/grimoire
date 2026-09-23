---
# GENERATED from skills/roast/evals/evals.json (id 1) by scripts/build-evals.mjs. Do not edit.
description: "roast #1 (positive)"
tags: [roast, positive]
plugins: ["../.."]
max_turns: 40
timeout_seconds: 900
allowed_tools: [Read, Glob, Grep, Skill, Agent, TodoWrite]
expected_outcome: "Runs the docs lane and the code lane together, diffs them, then interrogates the design one question per message with a recommendation each, pushing on edge cases (concurrency, partial failure, idempotency, load at target scale). Touches no code. On approval writes a short spec under docs/specs/ with problem, goals/non-goals, numbered decisions with rejected alternatives, vertical slices, edge cases, user-owned questions, plus Sources consulted, Self-answered questions and Docs drift fixed. Then passes the spec to to-plan."
---

Before anyone writes code, roast this idea: add rate limiting to the login endpoint in the API repo.
