---
# GENERATED from skills/logs/evals/evals.json (id 6) by scripts/build-evals.mjs. Do not edit.
description: "logs #6 (edge)"
tags: [logs, edge]
plugins: ["../.."]
max_turns: 40
timeout_seconds: 900
allowed_tools: [Read, Glob, Grep, Skill, Agent, TodoWrite]
expected_outcome: "Runs node <root>/scripts/render-logs.mjs summary (or summary --json) from the project root and answers from the cost lines: the run's effective tokens (cache reads, cache writes and output priced as billed), how much of it was output tokens, and where it went by dispatch kind, model tier, review lens and repo, largest first. Quotes the cost coverage, and says a run whose transcripts are not on this machine has no cost. Offers the page's Cost by dispatch view for the per-agent bill, without publishing it."
---

What did last night's loop run actually cost, and where did the money go?
