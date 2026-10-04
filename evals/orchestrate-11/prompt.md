---
# GENERATED from skills/orchestrate/evals/evals.json (id 11) by scripts/build-evals.mjs. Do not edit.
description: "orchestrate #11 (edge)"
tags: [orchestrate, edge]
plugins: ["../.."]
max_turns: 40
timeout_seconds: 900
allowed_tools: [Read, Glob, Grep, Skill, Agent, TodoWrite]
expected_outcome: "Before launching, warns that a message sent to this session while the workflow runs is relayed into the prompts of the agents it dispatches, so mid-run instructions can derail them (a probe once ran the build and the gate on one): instructions go in before the launch (as config or args) or after the run ends, or the run is stopped first. Does not plan to relay instructions to running agents."
---

Launch the execute run on EXPORT. I'll keep chatting here while it runs and tell the agents to skip the WebKit tests if they get slow.
