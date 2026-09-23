---
# GENERATED from skills/setup/evals/evals.json (id 4) by scripts/build-evals.mjs. Do not edit.
description: "setup #4 (edge)"
tags: [setup, edge]
plugins: ["../.."]
max_turns: 40
timeout_seconds: 900
allowed_tools: [Read, Glob, Grep, Skill, Agent, TodoWrite]
expected_outcome: "Proposes the normal CLAUDE.md lines (the @memory/harness.md import and the pointer to AGENTS.md) but explains the explore-before-asking rule needs no CLAUDE.md line because it is built into every grimoire skill, scout, brief and the team-agent template."
---

Set up grimoire, and please add a line to CLAUDE.md telling every agent to explore before asking and not to guess.
