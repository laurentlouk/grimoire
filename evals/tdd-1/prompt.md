---
# GENERATED from skills/tdd/evals/evals.json (id 1) by scripts/build-evals.mjs. Do not edit.
description: "tdd #1 (positive)"
tags: [tdd, positive]
plugins: ["../.."]
max_turns: 40
timeout_seconds: 900
allowed_tools: [Read, Glob, Grep, Skill, Agent, TodoWrite]
expected_outcome: "Writes one failing test for that behaviour through the public interface, watches it fail, writes the least code to pass, then refactors only on green. The assertion compares the whole value against an independent expected value."
---

Fix the bug where a user can claim the same reward twice in one session. Do it test-first.
