---
# GENERATED from skills/orchestrate/evals/evals.json (id 10) by scripts/build-evals.mjs. Do not edit.
description: "orchestrate #10 (edge)"
tags: [orchestrate, edge]
plugins: ["../.."]
max_turns: 40
timeout_seconds: 900
allowed_tools: [Read, Glob, Grep, Skill, Agent, TodoWrite]
expected_outcome: "Before launching, finds the existing run: the matching <telemetry.dir>/*/run.json (the most recently updated) or, failing that, the state marker in the draft PR on the run branch. Runs the preview with that runId and resumeState and shows its proof (the '◎ resume:' line: k/n landed, verified on the run branch at its head SHA, the draft PR) and what is still to build, then relaunches without resumeFromRunId, with the same runId and resumeState set to that checkpoint. Does not start a fresh run."
---

New session. Re-run the orchestrator on the EXPORT spec and plan, same as before; it halted yesterday partway through.
