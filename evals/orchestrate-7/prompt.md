---
# GENERATED from skills/orchestrate/evals/evals.json (id 7) by scripts/build-evals.mjs. Do not edit.
description: "orchestrate #7 (edge)"
tags: [orchestrate, edge]
plugins: ["../.."]
max_turns: 40
timeout_seconds: 900
allowed_tools: [Read, Glob, Grep, Skill, Agent, TodoWrite]
expected_outcome: "Does not use resumeFromRunId, because the args change: the replay would diverge at the first changed prompt or late result and redo landed work. Reads .grimoire/runs/20261003-115400-export/run.json fresh, right before launching, and relaunches with the same runId, resumeState set to its checkpoint, and agentTimeoutMin: 90 (explaining that it is now a soft limit: late agents are awaited, not booked dead)."
---

Run 20261003-115400-export stopped because agents kept timing out. Raise agentTimeoutMin to 90 and resume it.
