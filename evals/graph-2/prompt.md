---
# GENERATED from skills/graph/evals/evals.json (id 2) by scripts/build-evals.mjs. Do not edit.
description: "graph #2 (edge)"
tags: [graph, edge]
plugins: ["../.."]
max_turns: 40
timeout_seconds: 900
allowed_tools: [Read, Glob, Grep, Skill, Agent, TodoWrite]
expected_outcome: "Checks grimoire.config.json for graph.enabled, runs node <root>/tools/graph/graph.mjs index (the script, not a model reading files), notes that the first run installs the parser runtime once per machine, and reports the per-repo counts it prints. Offers to render the page afterwards."
---

Rebuild the graph index, it's never been built here.
