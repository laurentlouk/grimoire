---
# GENERATED from skills/orchestrate/evals/evals.json (id 9) by scripts/build-evals.mjs. Do not edit.
description: "orchestrate #9 (edge)"
tags: [orchestrate, edge]
plugins: ["../.."]
max_turns: 40
timeout_seconds: 900
allowed_tools: [Read, Glob, Grep, Skill, Agent, TodoWrite]
expected_outcome: "Treats the halt as a machine state, not failed code: points at the status comment on the repo's draft PR (the halt reason, what landed, the fix) and the environment fix first (unlock or approve the commit-signing agent and confirm a signed commit works), then relaunches by state with the same runId and resumeState from a fresh run.json, without resumeFromRunId and without starting from scratch."
---

The EXPORT run halted overnight with "environment: commit:api timed out after 30 s". What now?
