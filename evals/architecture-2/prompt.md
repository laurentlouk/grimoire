---
# GENERATED from skills/architecture/evals/evals.json (id 2) by scripts/build-evals.mjs. Do not edit.
description: "architecture #2 (edge)"
tags: [architecture, edge]
plugins: ["../.."]
max_turns: 40
timeout_seconds: 900
allowed_tools: [Read, Glob, Grep, Skill, Agent, TodoWrite]
expected_outcome: "Starts from the existing diagram, never a fresh draft over it. Runs graph.mjs architecture check on it first and reads its warnings as the drift (a module no component covers, links no line draws). Reads the billing worker's code and config, adds it as a worker component with paths, sources and its connections (what it consumes, what it writes), keeps the existing refined names and layout, and checks again until there is no error."
---

We added a billing worker last week and the architecture diagram in docs/architecture is out of date. Update it.
