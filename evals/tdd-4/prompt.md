---
# GENERATED from skills/tdd/evals/evals.json (id 4) by scripts/build-evals.mjs. Do not edit.
description: "tdd #4 (edge)"
tags: [tdd, edge]
plugins: ["../.."]
max_turns: 40
timeout_seconds: 900
allowed_tools: [Read, Glob, Grep, Skill, Agent, TodoWrite]
expected_outcome: "Does not mock the team's own ledger module and does not assert call counts or order; mocks only at the edges (outside APIs, clock, randomness) and asserts behaviour through the public interface."
---

Test the checkout service test-first. Mock our own ledger module and assert it gets called exactly twice, in order.
