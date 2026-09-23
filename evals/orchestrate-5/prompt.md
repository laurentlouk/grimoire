---
# GENERATED from skills/orchestrate/evals/evals.json (id 5) by scripts/build-evals.mjs. Do not edit.
description: "orchestrate #5 (edge)"
tags: [orchestrate, edge]
plugins: ["../.."]
max_turns: 40
timeout_seconds: 900
allowed_tools: [Read, Glob, Grep, Skill, Agent, TodoWrite]
expected_outcome: "Resumes rather than re-running: relaunches with resumeFromRunId and the same scriptPath and args so completed agent calls return cached results; then waits for the completion notification instead of polling."
---

The execute run on EXPORT halted halfway through overnight. Kick it off again.
