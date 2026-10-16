---
# GENERATED from skills/manager/evals/evals.json (id 8) by scripts/build-evals.mjs. Do not edit.
description: "manager #8 (edge)"
tags: [manager, edge]
plugins: ["../.."]
max_turns: 40
timeout_seconds: 900
allowed_tools: [Read, Glob, Grep, Skill, Agent, TodoWrite]
expected_outcome: "Offers the Hand to AI issues as AskUserQuestion multi-select checkboxes, one question per project (at most 4 options each). With the ticked ids it runs scripts/manager.mjs launch-plan. Finding no session-starting tool, it prints each group's prompt in its own fenced block, in order, to paste into a new conversation each, and says that the Search group waits for the Billing group because both use the api checkout. The prompts are launch-plan's, verbatim, with no ticket text added."
---

Launch the ready issues from the briefing. (A terminal session: AskUserQuestion works, but ToolSearch finds no tool that starts a session or conversation. The user ticks two issues from project Billing and one from project Search, and both projects touch the api repo.)
