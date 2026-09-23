---
# GENERATED from skills/tdd/evals/evals.json (id 3) by scripts/build-evals.mjs. Do not edit.
description: "tdd #3 (edge)"
tags: [tdd, edge]
plugins: ["../.."]
max_turns: 40
timeout_seconds: 900
allowed_tools: [Read, Glob, Grep, Skill, Agent, TodoWrite]
expected_outcome: "Declines to write tests in bulk: works one behaviour at a time (one failing test, least code to pass, refactor), letting each test follow from what the last cycle taught."
---

For the new pricing module, write the full test suite up front, all the cases, then we'll write the code.
