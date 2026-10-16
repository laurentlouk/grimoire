---
# GENERATED from skills/setup/evals/evals.json (id 10) by scripts/build-evals.mjs. Do not edit.
description: "setup #10 (edge)"
tags: [setup, edge]
plugins: ["../.."]
max_turns: 40
timeout_seconds: 900
allowed_tools: [Read, Glob, Grep, Skill, Agent, TodoWrite]
expected_outcome: "Treats it as a re-run: reads grimoire.config.json through config-merge.mjs and diffs the proposal without --write. It builds manager.urgent, priorityLabels and maxItemsPerSource from the current block, taking a default only for a key the block lacks, so the proposal carries stalledDays 10 and the diff shows no CHANGED key for manager.urgent: no 10 → 5 for the user to decline. Every other manager key the user has is kept. When the diff lists nothing added or changed, it says the setup is current and writes nothing; otherwise nothing is written before the yes, and no --approve names manager.urgent.stalledDays."
---

Re-run the grimoire setup to pick up the latest plugin. The manager block is already in grimoire.config.json. I changed manager.urgent.stalledDays to 10 by hand, because our sprints are two weeks long.
