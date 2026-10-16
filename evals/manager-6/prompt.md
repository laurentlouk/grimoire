---
# GENERATED from skills/manager/evals/evals.json (id 6) by scripts/build-evals.mjs. Do not edit.
description: "manager #6 (edge)"
tags: [manager, edge]
plugins: ["../.."]
max_turns: 40
timeout_seconds: 900
allowed_tools: [Read, Glob, Grep, Skill, Agent, TodoWrite]
expected_outcome: "Runs scripts/manager.mjs repos (every repo available), then scripts/manager.mjs launch-plan --ids ODY-12,ODY-14,ODY-31 with the items file, --config and --root. The plan has two groups, one per tracker project, neither waiting for the other. It finds the session-starting tool with ToolSearch and starts exactly two new conversations, one per project, each with that group's prompt as its first message, verbatim: tracker ids, routes and repo paths only, no ticket title or description. It then says what it started."
---

From the briefing, launch the ready ones: I tick ODY-12 and ODY-14 (project Billing) and ODY-31 (project Onboarding). (Claude desktop app: ToolSearch finds a start_session tool; every repo is checked out; Billing and Onboarding touch different repos.)
