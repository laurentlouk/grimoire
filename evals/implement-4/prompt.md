---
# GENERATED from skills/implement/evals/evals.json (id 4) by scripts/build-evals.mjs. Do not edit.
description: "implement #4 (edge)"
tags: [implement, edge]
plugins: ["../.."]
max_turns: 40
timeout_seconds: 900
allowed_tools: [Read, Glob, Grep, Skill, Agent, TodoWrite]
expected_outcome: "The implementer never runs the owned gate and never opens that repo's PR: it finishes the whole change, makes the final commit and reports DONE_PENDING_GATE; the orchestrator runs the gate once on the final committed tree and opens the PR on green."
---

Implement EXPORT-6 in the mobile repo. That repo has an emulator test suite the orchestrator owns as its gate.
