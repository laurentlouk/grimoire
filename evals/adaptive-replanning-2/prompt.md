---
# GENERATED from skills/adaptive-replanning/evals/evals.json (id 2) by scripts/build-evals.mjs. Do not edit.
description: "adaptive-replanning #2 (negative)"
tags: [adaptive-replanning, negative]
plugins: ["../.."]
max_turns: 40
timeout_seconds: 900
allowed_tools: [Read, Glob, Grep, Skill, Agent, TodoWrite]
expected_outcome: "Launching the loop is `orchestrate`'s job; adaptive-replanning only explains, tunes or debugs replanning."
---

Launch the loop on the EXPORT project in preview.
