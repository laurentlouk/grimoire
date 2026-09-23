---
# GENERATED from skills/launch-agent/evals/evals.json (id 4) by scripts/build-evals.mjs. Do not edit.
description: "launch-agent #4 (edge)"
tags: [launch-agent, edge]
plugins: ["../.."]
max_turns: 40
timeout_seconds: 900
allowed_tools: [Read, Glob, Grep, Skill, Agent, TodoWrite]
expected_outcome: "Dispatches the engineer but does not ask it to write memory; explains that crystallize writes memory, after the PR."
---

Send the API engineer on EXPORT-3, and tell it to save anything it learns to its memory file as it goes.
