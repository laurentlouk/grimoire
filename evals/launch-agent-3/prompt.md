---
# GENERATED from skills/launch-agent/evals/evals.json (id 3) by scripts/build-evals.mjs. Do not edit.
description: "launch-agent #3 (edge)"
tags: [launch-agent, edge]
plugins: ["../.."]
max_turns: 40
timeout_seconds: 900
allowed_tools: [Read, Glob, Grep, Skill, Agent, TodoWrite]
expected_outcome: "Pastes the reviewer's memory entries verbatim (all three, unedited) under '## Your memory' at the top of the brief; does not summarise."
---

Launch the reviewer on PR #214. Its memory file has three entries; just summarise them in a sentence to keep the brief short.
