---
# GENERATED from skills/manager/evals/evals.json (id 4) by scripts/build-evals.mjs. Do not edit.
description: "manager #4 (edge)"
tags: [manager, edge]
plugins: ["../.."]
max_turns: 40
timeout_seconds: 900
allowed_tools: [Read, Glob, Grep, Skill, Agent, TodoWrite]
expected_outcome: "Runs the briefing the same way (tracker-scout per tracker source, then scripts/manager.mjs brief with --check-repos) and answers from its Hand to AI group: the issues with acceptance criteria, not started, no assignee (or claim.identity), nothing open blocking them, no linked PR, no sub-issues, and a repos[] entry that is checked out, each with its repo and next step. Explains why a candidate the user names is not there by quoting its reason from the briefing. It offers the ready issues as checkboxes and launches only what the user ticks: nothing is launched, dispatched or looped on its own."
---

What can we hand to AI next from the tracker?
