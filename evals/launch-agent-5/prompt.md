---
# GENERATED from skills/launch-agent/evals/evals.json (id 5) by scripts/build-evals.mjs. Do not edit.
description: "launch-agent #5 (edge)"
tags: [launch-agent, edge]
plugins: ["../.."]
max_turns: 40
timeout_seconds: 900
allowed_tools: [Read, Glob, Grep, Skill, Agent, TodoWrite]
expected_outcome: "Dispatches two independent read-only scouts in one message so they run together; scouts get no memory; each brief carries the explore-before-asking rule."
---

Send scouts to find where exports are serialized and which endpoints paginate.
