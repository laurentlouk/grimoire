---
# GENERATED from skills/implement/evals/evals.json (id 1) by scripts/build-evals.mjs. Do not edit.
description: "implement #1 (positive)"
tags: [implement, positive]
plugins: ["../.."]
max_turns: 40
timeout_seconds: 900
allowed_tools: [Read, Glob, Grep, Skill, Agent, TodoWrite]
expected_outcome: "Dispatches the team agent that owns the API repo from AGENTS.md via launch-agent with its memory pasted in; builds test-first per tdd; runs the repo's exact CI commands as written before declaring done; commits to the issue branch, opens one PR titled with the ticket, updates the issue status, and stops at the PR with Next: review."
---

Implement EXPORT-2 (slice 2, touches only the API repo).
