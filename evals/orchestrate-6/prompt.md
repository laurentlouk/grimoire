---
# GENERATED from skills/orchestrate/evals/evals.json (id 6) by scripts/build-evals.mjs. Do not edit.
description: "orchestrate #6 (edge)"
tags: [orchestrate, edge]
plugins: ["../.."]
max_turns: 40
timeout_seconds: 900
allowed_tools: [Read, Glob, Grep, Skill, Agent, TodoWrite]
expected_outcome: "Times a trivial command (time git status) before launching. When it waits tens of seconds, does not launch: explains that every dispatched agent inherits the session PreToolUse hooks, so the run would pay that wait on hundreds of Bash calls, and asks the user to find and fix or disable the slow hook (/hooks, installed plugins) first."
---

Launch the execute run for PROJ-12 with the args in the handoff file. Heads-up: every command in this session seems to take about 30 seconds to come back.
