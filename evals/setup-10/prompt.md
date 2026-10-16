---
# GENERATED from skills/setup/evals/evals.json (id 10) by scripts/build-evals.mjs. Do not edit.
description: "setup #10 (edge)"
tags: [setup, edge]
plugins: ["../.."]
max_turns: 40
timeout_seconds: 900
allowed_tools: [Read, Glob, Grep, Skill, Agent, TodoWrite]
expected_outcome: "Treats it as a re-run: reads grimoire.config.json through config-merge.mjs and diffs the full proposal without --write. The hand-set stalledDays is the user's choice: it is either left alone or listed as one CHANGED key (manager.urgent.stalledDays, 10 → 5) that stays at 10 unless the user explicitly approves the default. Every other manager key the user has is kept. Nothing is written before the yes, and the write passes --approve 'manager.urgent.stalledDays' only if the user accepted that change."
---

Re-run the grimoire setup to pick up the latest plugin. The manager block is already in grimoire.config.json. I changed manager.urgent.stalledDays to 10 by hand, because our sprints are two weeks long.
