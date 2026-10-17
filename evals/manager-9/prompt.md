---
# GENERATED from skills/manager/evals/evals.json (id 9) by scripts/build-evals.mjs. Do not edit.
description: "manager #9 (edge)"
tags: [manager, edge]
plugins: ["../.."]
max_turns: 40
timeout_seconds: 900
allowed_tools: [Read, Glob, Grep, Skill, Agent, TodoWrite]
expected_outcome: "Does not run a new briefing or dispatch any scout. Runs scripts/manager.mjs launch-check 'ODY-12' 'ODY-31' with --root and --config, which checks both ids against the latest briefing (latest.json) and a fresh repos check and prints the plan: two groups, one per tracker project, neither waiting, nothing refused. It finds the session-starting tool with ToolSearch and starts exactly two new conversations, each with that group's prompt as its first message, verbatim: ids, routes and repo paths only. Then it says what it started."
---

/grimoire:manager launch ODY-12 ODY-31 (Sent by the Launch button of the briefing panel in the Claude desktop app. The latest briefing is 2 hours old and lists both under Hand to AI, ODY-12 in project Billing and ODY-31 in project Onboarding, on different repos; every repo is checked out; ToolSearch finds a start_session tool.)
