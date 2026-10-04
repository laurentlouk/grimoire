---
# GENERATED from skills/orchestrate/evals/evals.json (id 12) by scripts/build-evals.mjs. Do not edit.
description: "orchestrate #12 (edge)"
tags: [orchestrate, edge]
plugins: ["../.."]
max_turns: 40
timeout_seconds: 900
allowed_tools: [Read, Glob, Grep, Skill, Agent, TodoWrite]
expected_outcome: "Treats starting over as an explicit request: warns that every landed task is built and reviewed again and the replan, fix and spend budgets reset, then launches with freshStart: true and a new runId (preview first), not by dropping resumeState alone (the engine would still absorb what the draft PR's marker lists). Says that if origin already holds the old run branch with commits not in the base, the run refuses as run_branch_exists, and that the way out is a new runBranch name or closing the old PR and deleting that branch, which is the user's call."
---

Forget the EXPORT run that halted yesterday: start it over completely from scratch, I don't trust what it built.
