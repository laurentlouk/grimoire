---
# GENERATED from skills/graph/evals/evals.json (id 7) by scripts/build-evals.mjs. Do not edit.
description: "graph #7 (negative)"
tags: [graph, negative]
plugins: ["../.."]
max_turns: 40
timeout_seconds: 900
allowed_tools: [Read, Glob, Grep, Skill, Agent, TodoWrite]
expected_outcome: "Drawing a diagram is the architecture skill's job (draft, refine from the code, check); the graph skill only renders the page that shows it."
---

Draw me an architecture diagram of this repo.
