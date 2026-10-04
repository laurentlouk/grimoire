---
# GENERATED from skills/orchestrate/evals/evals.json (id 8) by scripts/build-evals.mjs. Do not edit.
description: "orchestrate #8 (edge)"
tags: [orchestrate, edge]
plugins: ["../.."]
max_turns: 40
timeout_seconds: 900
allowed_tools: [Read, Glob, Grep, Skill, Agent, TodoWrite]
expected_outcome: "Launches a preview (no execute: true) and prints, besides the dependency graph and review panels, the duration estimate from the result's estimate (hours low–high, number of tasks, critical path, and that a strict blocked-by chain runs one task at a time whatever maxPerRepo is); says a draft PR appears after the first landed task; names the environment checks the run will make (commit:<repo>, remote:<repo>, and any environmentChecks)."
---

Preview what the loop would do on the EXPORT project before we commit to anything. Spec and plan are in docs/, grimoire.config.json is at the root.
