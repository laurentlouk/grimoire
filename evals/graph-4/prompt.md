---
# GENERATED from skills/graph/evals/evals.json (id 4) by scripts/build-evals.mjs. Do not edit.
description: "graph #4 (negative)"
tags: [graph, negative]
plugins: ["../.."]
max_turns: 40
timeout_seconds: 900
allowed_tools: [Read, Glob, Grep, Skill, Agent, TodoWrite]
expected_outcome: "A narrow graph question is answered with the graph_callers tool (or a scout), then confirmed in the code; it does not need the HTML page, so the graph skill is not used."
---

Who calls Session.refresh?
