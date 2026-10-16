---
# GENERATED from skills/manager/evals/evals.json (id 3) by scripts/build-evals.mjs. Do not edit.
description: "manager #3 (negative)"
tags: [manager, negative]
plugins: ["../.."]
max_turns: 40
timeout_seconds: 900
allowed_tools: [Read, Glob, Grep, Skill, Agent, TodoWrite]
expected_outcome: "Building a tracker project unattended is the orchestrate skill's job (the build loop), not the manager's. The manager skill is not used: no briefing is produced and scripts/manager.mjs is not run."
---

Build this whole project unattended, all of its slices.
