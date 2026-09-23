---
# GENERATED from skills/roast/evals/evals.json (id 3) by scripts/build-evals.mjs. Do not edit.
description: "roast #3 (edge)"
tags: [roast, edge]
plugins: ["../.."]
max_turns: 40
timeout_seconds: 900
allowed_tools: [Read, Glob, Grep, Skill, Agent, TodoWrite]
expected_outcome: "Answers both facts itself from the code or config (sending a scout if the search is wide), cites the file and location, and does not ask the user for them; records them under Self-answered questions. Only product or trade-off decisions (e.g. how long a customer may wait) reach the user, one per message with a recommendation."
---

Roast adding retries to the webhook consumer in the API repo. I don't remember which queue client we use or what the current retry limit is.
