---
# GENERATED from skills/data-model/evals/evals.json (id 7) by scripts/build-evals.mjs. Do not edit.
description: "data-model #7 (edge)"
tags: [data-model, edge]
plugins: ["../.."]
max_turns: 40
timeout_seconds: 900
allowed_tools: [Read, Glob, Grep, Skill, Agent, TodoWrite]
expected_outcome: "Reads graph_data for the store: its Leads, Ambiguous names and Links to other stores. For each lead, reads the code that looks the target up with that attribute (the access patterns, queries and cache commands point to it) before claiming anything. Finds that like_id holds a user's id and writes a relations claim from user_likes(like_id) to the user table, which replaces the wrong lead; confirms messages.sender_id as a reference to the user table found through the lookups, though the name rule missed it; claims the Redis template's placeholder as a column (backend:redis/orbit:{orbit_id}, columns [\"orbit_id\"]) to the orbit table. Every claim cites the line that shows it; runs graph.mjs data check until nothing drifts, and says the store now shows those lines dashed, not dotted."
---

The Data tab draws dotted lines on our DynamoDB diagram: user_likes.like_id points at likes, and nothing links messages.sender_id or the Redis key orbit:{orbit_id} to anything solid. Refine those links.
