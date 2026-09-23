---
# GENERATED from skills/graph/evals/evals.json (id 3) by scripts/build-evals.mjs. Do not edit.
description: "graph #3 (negative)"
tags: [graph, negative]
plugins: ["../.."]
max_turns: 40
timeout_seconds: 900
allowed_tools: [Read, Glob, Grep, Skill, Agent, TodoWrite]
expected_outcome: "The run log is the logs skill's job (scripts/render-logs.mjs). The graph skill is not used: no graph page is rendered."
---

Open the run log for last night's loop run.
