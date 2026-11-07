---
# GENERATED from skills/data-model/evals/evals.json (id 5) by scripts/build-evals.mjs. Do not edit.
description: "data-model #5 (negative)"
tags: [data-model, negative]
plugins: ["../.."]
max_turns: 40
timeout_seconds: 900
allowed_tools: [Read, Glob, Grep, Skill, Agent, TodoWrite]
expected_outcome: "A schema change is code work (a migration, through implement or the migration engineer); the data model refine skill is not used and no refine file is edited."
---

Add a nullable `archived_at` column to the events table with a migration.
