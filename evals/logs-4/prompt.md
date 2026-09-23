---
# GENERATED from skills/logs/evals/evals.json (id 4) by scripts/build-evals.mjs. Do not edit.
description: "logs #4 (edge)"
tags: [logs, edge]
plugins: ["../.."]
max_turns: 40
timeout_seconds: 900
allowed_tools: [Read, Glob, Grep, Skill, Agent, TodoWrite]
expected_outcome: "Runs node <root>/scripts/render-logs.mjs prune --days 30 --dry-run first and shows what would go, then prune --days 30. Only run directories (holding run.json, events/ or events.jsonl) inside the telemetry dir are removed; the committed ledgers in runsDir and any other directory are untouched. Mentions telemetry.retentionDays in grimoire.config.json for a permanent change."
---

Prune the old logs, but only keep 30 days.
