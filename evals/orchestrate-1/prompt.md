---
# GENERATED from skills/orchestrate/evals/evals.json (id 1) by scripts/build-evals.mjs. Do not edit.
description: "orchestrate #1 (positive)"
tags: [orchestrate, positive]
plugins: ["../.."]
max_turns: 40
timeout_seconds: 900
allowed_tools: [Read, Glob, Grep, Skill, Agent, TodoWrite]
expected_outcome: "Checks the spec, plan, project and repos from grimoire.config.json; launches the workflow by path (<plugin root>/workflows/orchestrate-loop.js) with briefsDir and personasDir, in preview mode by default; shows the dependency graph and each repo's review panel; asks for a clear yes before an execute run."
---

Orchestrate the EXPORT tracker project. Spec is docs/specs/2026-09-10-export-design.md, plan is docs/plans/2026-09-12-export-plan.md, and grimoire.config.json is at the root.
