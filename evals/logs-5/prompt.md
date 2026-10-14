---
# GENERATED from skills/logs/evals/evals.json (id 5) by scripts/build-evals.mjs. Do not edit.
description: "logs #5 (edge)"
tags: [logs, edge]
plugins: ["../.."]
max_turns: 40
timeout_seconds: 900
allowed_tools: [Read, Glob, Grep, Skill, Agent, TodoWrite]
expected_outcome: "Runs node <root>/scripts/render-logs.mjs summary (or summary --json) from the project root and answers from its outcomes block: runs by outcome (drained, halted, running, stale), run success as drained over finished runs and task landing as landed over settled tasks, each quoted with its counts, and the halts grouped by kind with the latest reason, noting the pre-0.9.0 ones are unclassified. Flags runs whose journal is incomplete (events missing, unfinished writes) as undercounted, and does not draw a trend from a handful of runs. Offers to render the page, whose scorecard shows the same numbers, without publishing it."
---

How are the loop runs doing lately? What's our success rate, and why do runs halt?
