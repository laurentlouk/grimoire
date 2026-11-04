---
# GENERATED from skills/setup/evals/evals.json (id 16) by scripts/build-evals.mjs. Do not edit.
description: "setup #16 (edge)"
tags: [setup, edge]
plugins: ["../.."]
max_turns: 40
timeout_seconds: 900
allowed_tools: [Read, Glob, Grep, Skill, Agent, TodoWrite]
expected_outcome: "Keeps the existing api-engineer definition and proposes adding the template's disallowedTools line, one mcp__ccd_<server>__* entry per desktop-app server, explaining that those servers act on the launching session, written only on the user's yes."
---

Set up grimoire here. We already have .claude/agents/api-engineer.md, written by hand, with no disallowedTools line.
