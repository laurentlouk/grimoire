---
# GENERATED from skills/logs/evals/evals.json (id 2) by scripts/build-evals.mjs. Do not edit.
description: "logs #2 (edge)"
tags: [logs, edge]
plugins: ["../.."]
max_turns: 40
timeout_seconds: 900
allowed_tools: [Read, Glob, Grep, Skill, Agent, TodoWrite]
expected_outcome: "Finds the plugin root two directories above the SKILL.md, runs node <root>/scripts/render-logs.mjs from the project root (with --run <runId> for last night's run), takes the path it prints (default .grimoire/logs.html) and opens it locally with open or xdg-open. Does not publish, upload or share the page, because the log holds code details and review findings."
---

Open the run log for last night's run so I can browse it.
