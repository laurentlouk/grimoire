---
# GENERATED from skills/roast/evals/evals.json (id 5) by scripts/build-evals.mjs. Do not edit.
description: "roast #5 (edge)"
tags: [roast, edge]
plugins: ["../.."]
max_turns: 40
timeout_seconds: 900
allowed_tools: [Read, Glob, Grep, Skill, Agent, TodoWrite]
expected_outcome: "Looks outward at credible open-source projects using the same technologies (widely adopted, active in the last year, known license), reads the actual code path, maps the pattern onto this codebase and writes down what is not adopted. Treats the stack and architecture as fixed inputs: it borrows the pattern, never the stack, so it does not recommend switching broker."
---

Roast idempotent webhook delivery. We have no precedent for it in this codebase; should we just switch to the message broker the big projects use?
