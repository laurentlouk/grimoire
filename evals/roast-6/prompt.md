---
# GENERATED from skills/roast/evals/evals.json (id 6) by scripts/build-evals.mjs. Do not edit.
description: "roast #6 (edge)"
tags: [roast, edge]
plugins: ["../.."]
max_turns: 40
timeout_seconds: 900
allowed_tools: [Read, Glob, Grep, Skill, Agent, TodoWrite]
expected_outcome: "Before approving, runs the proposed routing rule over the recorded runs and states in the spec what share of tasks it would send down the cheaper path, next to the claimed saving; treats an unmeasured share as a guess and recalibrates the claim when the share is small."
---

Roast a plan to route small tasks to a cheaper review path and save about 20 % per run. Recorded runs are under .grimoire/runs.
