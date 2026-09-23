---
# GENERATED from skills/adaptive-replanning/evals/evals.json (id 1) by scripts/build-evals.mjs. Do not edit.
description: "adaptive-replanning #1 (positive)"
tags: [adaptive-replanning, positive]
plugins: ["../.."]
max_turns: 40
timeout_seconds: 900
allowed_tools: [Read, Glob, Grep, Skill, Agent, TodoWrite]
expected_outcome: "Distinguishes the inner fix loop (same task, retried with findings, bounded attempts) from the outer replan loop (whole remaining plan, bounded by the replan budget); explains the replan starts from the current state, leaves finished work untouched, feeds the failure's cause in, and returns revised tasks in the same shape or a reasoned stop."
---

Explain why the loop replanned slice 3 after the fix attempts on its second task ran out.
