---
# GENERATED from skills/manager/evals/evals.json (id 2) by scripts/build-evals.mjs. Do not edit.
description: "manager #2 (edge)"
tags: [manager, edge]
plugins: ["../.."]
max_turns: 40
timeout_seconds: 900
allowed_tools: [Read, Glob, Grep, Skill, Agent, TodoWrite]
expected_outcome: "Finds no manager block in grimoire.config.json and falls back to toolHints.tracker as a single source with the id tracker. Says so plainly in the reply and points at /grimoire:setup to add the manager section. Asks which team or project to read only if no scope can be found in the config, then dispatches tracker-scout once with that source, runs scripts/manager.mjs brief on the WorkItems, and shows the result."
---

Give me the briefing: what should we do next? (We haven't added a manager block to grimoire.config.json yet; Linear is in toolHints.tracker.)
