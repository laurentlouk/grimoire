---
# GENERATED from skills/crystallize/evals/evals.json (id 1) by scripts/build-evals.mjs. Do not edit.
description: "crystallize #1 (positive)"
tags: [crystallize, positive]
plugins: ["../.."]
max_turns: 40
timeout_seconds: 900
allowed_tools: [Read, Glob, Grep, Skill, Agent, TodoWrite]
expected_outcome: "Reads the PR diff and every review thread with its resolution; patches the closest umbrella skill with the ordering gotcha and adds an eval case; adds a dated declarative fact to the API role's memory store if it applies to every future task; records both questions as roast misses; writes docs/crystallize/<date>-api-pr212.md and opens a crystallize PR; summarises created/patched items in one screen."
---

PR #212 on the API repo is merged. A review bot flagged an ordering race we fixed in 3f2a1c, and the implementer had to stop twice to ask about the dedup marker. Crystallize it.
