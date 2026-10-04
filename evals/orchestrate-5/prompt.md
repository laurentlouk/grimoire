---
# GENERATED from skills/orchestrate/evals/evals.json (id 5) by scripts/build-evals.mjs. Do not edit.
description: "orchestrate #5 (edge)"
tags: [orchestrate, edge]
plugins: ["../.."]
max_turns: 40
timeout_seconds: 900
allowed_tools: [Read, Glob, Grep, Skill, Agent, TodoWrite]
expected_outcome: "Resumes by state rather than re-running: reads the run's <telemetry.dir>/<runId>/run.json fresh, right before launching, and relaunches without resumeFromRunId, with the same runId and resumeState set to its checkpoint (the engine reads the draft PR's state marker itself and verifies every landed SHA), so landed tasks are absorbed and the budgets kept; uses resumeFromRunId only for a byte-identical relaunch in the same session; reads the halt reason (the draft PR's status comment) before relaunching; then waits for the completion notification instead of polling."
---

The execute run on EXPORT halted halfway through overnight. Kick it off again.
