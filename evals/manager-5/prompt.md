---
# GENERATED from skills/manager/evals/evals.json (id 5) by scripts/build-evals.mjs. Do not edit.
description: "manager #5 (edge)"
tags: [manager, edge]
plugins: ["../.."]
max_turns: 40
timeout_seconds: 900
allowed_tools: [Read, Glob, Grep, Skill, Agent, TodoWrite]
expected_outcome: "Dispatches tracker-scout for both sources. The jira scout replies in prose naming the routes it tried, not with an empty array. The skill tries reading Jira in the session; when that fails too, it writes a sources file in the session scratchpad with linear as ok (its count) and jira as failed with a short reason and a fix (re-authorize the Jira connector), and runs scripts/manager.mjs brief with --items and --sources. It shows the briefing, says it is partial, and quotes the Not checked line for jira with its fix. It never presents Jira as having nothing open."
---

Brief me on the tracker. (grimoire.config.json has two tracker sources, linear and jira; the Jira connector's session has expired and there is no Jira CLI, Linear works.)
