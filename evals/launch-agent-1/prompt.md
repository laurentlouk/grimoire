---
# GENERATED from skills/launch-agent/evals/evals.json (id 1) by scripts/build-evals.mjs. Do not edit.
description: "launch-agent #1 (positive)"
tags: [launch-agent, positive]
plugins: ["../.."]
max_turns: 40
timeout_seconds: 900
allowed_tools: [Read, Glob, Grep, Skill, Agent, TodoWrite]
expected_outcome: "Reads AGENTS.md for the agent's model, tools and brief; reads memory/agents/<agent>.md and pastes its entries verbatim under '## Your memory' at the top; pastes the full task text, spec excerpt, files, success criteria and ticket; includes the explore-before-asking rule, the no-interactive-channel/NEEDS_CONTEXT reminder, incremental commits and the four end states; notes any orchestrator-owned gate."
---

Start the API engineer on EXPORT-2.
