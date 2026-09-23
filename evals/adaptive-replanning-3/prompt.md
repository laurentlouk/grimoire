---
# GENERATED from skills/adaptive-replanning/evals/evals.json (id 3) by scripts/build-evals.mjs. Do not edit.
description: "adaptive-replanning #3 (edge)"
tags: [adaptive-replanning, edge]
plugins: ["../.."]
max_turns: 40
timeout_seconds: 900
allowed_tools: [Read, Glob, Grep, Skill, Agent, TodoWrite]
expected_outcome: "Explains that a replan budget of zero turns replanning off, so the first failed slice stops the run; the untried tasks are marked skipped so nothing is silently dropped, and the run report lists them."
---

We set maxReplans to 0. Slice 2 failed its review after the fix rounds, and the whole run stopped. Why, and what happened to slices 3 to 5?
