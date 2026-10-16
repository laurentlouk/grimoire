---
# GENERATED from skills/manager/evals/evals.json (id 4) by scripts/build-evals.mjs. Do not edit.
description: "manager #4 (edge)"
tags: [manager, edge]
plugins: ["../.."]
max_turns: 40
timeout_seconds: 900
allowed_tools: [Read, Glob, Grep, Skill, Agent, TodoWrite]
expected_outcome: "Runs the briefing the same way (tracker-scout per tracker source, then scripts/manager.mjs brief) and answers from its Hand to AI group: the issues with acceptance criteria, no assignee, nothing open blocking them, no linked PR and no sub-issues, each with its next step. Says the repo availability is not checked yet, and points a ready loose issue at /implement or a sliced project at /orchestrate without launching anything itself. Explains why a candidate the user names is not there by quoting its reason from the briefing."
---

What can we hand to AI next from the tracker?
