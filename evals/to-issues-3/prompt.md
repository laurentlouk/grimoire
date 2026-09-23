---
# GENERATED from skills/to-issues/evals/evals.json (id 3) by scripts/build-evals.mjs. Do not edit.
description: "to-issues #3 (edge)"
tags: [to-issues, edge]
plugins: ["../.."]
max_turns: 40
timeout_seconds: 900
allowed_tools: [Read, Glob, Grep, Skill, Agent, TodoWrite]
expected_outcome: "Refuses to carve the work by layer; proposes vertical slices that each cut through database, API and UI and can be demoed alone; shows the numbered breakdown and waits for sign-off before creating anything, even though the user said 'now'."
---

Here's the agreed plan. Create the issues in the tracker now: one for the database changes, one for the API, one for the UI.
