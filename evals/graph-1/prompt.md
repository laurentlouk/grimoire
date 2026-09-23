---
# GENERATED from skills/graph/evals/evals.json (id 1) by scripts/build-evals.mjs. Do not edit.
description: "graph #1 (positive)"
tags: [graph, positive]
plugins: ["../.."]
max_turns: 40
timeout_seconds: 900
allowed_tools: [Read, Glob, Grep, Skill, Agent, TodoWrite]
expected_outcome: "Finds the plugin root two directories above the SKILL.md, runs node <root>/tools/graph/graph.mjs render from the project root (which refreshes the index first), takes the path it prints (default .grimoire/graph/graph.html) and opens it locally with open or xdg-open. Says the page is a map and stays local."
---

Show me the code graph of this project so I can see what depends on what.
