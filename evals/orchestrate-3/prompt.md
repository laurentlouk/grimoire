---
# GENERATED from skills/orchestrate/evals/evals.json (id 3) by scripts/build-evals.mjs. Do not edit.
description: "orchestrate #3 (edge)"
tags: [orchestrate, edge]
plugins: ["../.."]
max_turns: 40
timeout_seconds: 900
allowed_tools: [Read, Glob, Grep, Skill, Agent, TodoWrite]
expected_outcome: "Refuses to launch: says the spec (produced by roast) and the plan (produced by to-plan) are missing and names the skill that produces each."
---

Run the loop on the EXPORT project unattended, execute right away. We haven't written a spec or plan, the tickets are enough.
