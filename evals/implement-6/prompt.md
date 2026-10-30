---
# GENERATED from skills/implement/evals/evals.json (id 6) by scripts/build-evals.mjs. Do not edit.
description: "implement #6 (edge)"
tags: [implement, edge]
plugins: ["../.."]
max_turns: 40
timeout_seconds: 900
allowed_tools: [Read, Glob, Grep, Skill, Agent, TodoWrite]
expected_outcome: "Does not resume the same implementer a seventh time: writes a short handoff (branch, head, what is done, the open feedback) and starts a fresh implementer from it, which still waits on long commands in chunks of at most 4 minutes."
---

The webapp implementer for ODY-948 has been resumed six times this afternoon with Laurent's feedback, and it was compacted an hour ago. Send it the next round of feedback.
