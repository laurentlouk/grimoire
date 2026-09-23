---
# GENERATED from skills/implement/evals/evals.json (id 3) by scripts/build-evals.mjs. Do not edit.
description: "implement #3 (edge)"
tags: [implement, edge]
plugins: ["../.."]
max_turns: 40
timeout_seconds: 900
allowed_tools: [Read, Glob, Grep, Skill, Agent, TodoWrite]
expected_outcome: "Refuses to put two implementers on one checkout; within a repository tasks run one at a time in dependency order (parallel work inside one repo would need separate worktrees)."
---

EXPORT-4 and EXPORT-5 both touch the API repo and don't depend on each other. Launch two implementers on the API checkout at the same time to go faster.
