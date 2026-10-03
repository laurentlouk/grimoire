---
# GENERATED from skills/setup/evals/evals.json (id 5) by scripts/build-evals.mjs. Do not edit.
description: "setup #5 (edge)"
tags: [setup, edge]
plugins: ["../.."]
max_turns: 40
timeout_seconds: 900
allowed_tools: [Read, Glob, Grep, Skill, Agent, TodoWrite]
expected_outcome: "Proposes grimoire.config.json without a repos[].timeoutMin (a minute-long suite fits the 40-minute backstop, and a value at or under 40 does nothing), and without a laneSetup that symlinks node_modules (Next.js 16 Turbopack refuses a symlinked node_modules pointing outside the project root): it clones it into the lane (cp -cR) or proposes none."
---

Set up grimoire in this repo: one Next.js 16 app at the root, npm, Playwright e2e tests that take about a minute.
