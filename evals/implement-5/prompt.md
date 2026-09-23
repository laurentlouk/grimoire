---
# GENERATED from skills/implement/evals/evals.json (id 5) by scripts/build-evals.mjs. Do not edit.
description: "implement #5 (edge)"
tags: [implement, edge]
plugins: ["../.."]
max_turns: 40
timeout_seconds: 900
allowed_tools: [Read, Glob, Grep, Skill, Agent, TodoWrite]
expected_outcome: "The implementer first explores the code, contracts and docs for the project's pagination convention; if it is still unclear it returns NEEDS_CONTEXT with one specific question naming what it checked. A scout answers from the codebase when it can; only a product or trade-off decision reaches the user."
---

Implement EXPORT-7. The ticket says 'use the standard pagination' but doesn't say which one.
