---
# GENERATED from skills/orchestrate/evals/evals.json (id 2) by scripts/build-evals.mjs. Do not edit.
description: "orchestrate #2 (negative)"
tags: [orchestrate, negative]
plugins: ["../.."]
max_turns: 40
timeout_seconds: 900
allowed_tools: [Read, Glob, Grep, Skill, Agent, TodoWrite]
expected_outcome: "Explaining why the loop replanned or halted is `adaptive-replanning`'s job; orchestrate does not relaunch the loop for this."
---

Last night's loop replanned slice 3 twice and then stopped. Why did it do that?
