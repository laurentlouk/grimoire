---
# GENERATED from skills/data-model/evals/evals.json (id 2) by scripts/build-evals.mjs. Do not edit.
description: "data-model #2 (edge)"
tags: [data-model, edge]
plugins: ["../.."]
max_turns: 40
timeout_seconds: 900
allowed_tools: [Read, Glob, Grep, Skill, Agent, TodoWrite]
expected_outcome: "Treats the drift as the refine file disagreeing with the code, never as a reason to silence the check. Runs graph.mjs data check to list every drift, opens the cited file to find where the index is now queried (or learns it is no longer used), then edits the existing refine file in place: moves the citation to the line that names the index, or removes the claim if the code no longer supports it. Never cites an unrelated line just to pass. Runs data check again until it passes and tells the user what drifted and what was changed."
---

graph_data says my data map has drift: 'indexes[0] (line 25) index ... ByOwner: backend/src/events.ts line 3 names none of: ByOwner'. Fix it.
