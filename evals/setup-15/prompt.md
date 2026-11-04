---
# GENERATED from skills/setup/evals/evals.json (id 15) by scripts/build-evals.mjs. Do not edit.
description: "setup #15 (edge)"
tags: [setup, edge]
plugins: ["../.."]
max_turns: 40
timeout_seconds: 900
allowed_tools: [Read, Glob, Grep, Skill, Agent, TodoWrite]
expected_outcome: "Proposes maxCost in effective tokens beside maxOutputTokens in the config diff, sized from the recorded run's cost, explains that maxCost counts the real cost with the cache while maxOutputTokens counts output tokens only, says both are the user's call, and writes nothing before the user approves."
---

Set up grimoire for this project. Our last loop run cost about 40M effective tokens in /grimoire:logs and I want unattended runs capped.
