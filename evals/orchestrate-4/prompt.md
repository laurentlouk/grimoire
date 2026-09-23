---
# GENERATED from skills/orchestrate/evals/evals.json (id 4) by scripts/build-evals.mjs. Do not edit.
description: "orchestrate #4 (edge)"
tags: [orchestrate, edge]
plugins: ["../.."]
max_turns: 40
timeout_seconds: 900
allowed_tools: [Read, Glob, Grep, Skill, Agent, TodoWrite]
expected_outcome: "Says the config file is missing and points at /grimoire:setup; does not invent a repos table; does not launch."
---

Orchestrate EXPORT with the spec and plan in docs/. We never ran setup, so there's no grimoire.config.json; just figure out the repos.
