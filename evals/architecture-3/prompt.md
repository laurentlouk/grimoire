---
# GENERATED from skills/architecture/evals/evals.json (id 3) by scripts/build-evals.mjs. Do not edit.
description: "architecture #3 (negative)"
tags: [architecture, negative]
plugins: ["../.."]
max_turns: 40
timeout_seconds: 900
allowed_tools: [Read, Glob, Grep, Skill, Agent, TodoWrite]
expected_outcome: "A narrow call question is answered with the graph_callers tool (or a scout) and confirmed in the code. No architecture diagram is drafted or edited."
---

Who calls OrderService.place?
