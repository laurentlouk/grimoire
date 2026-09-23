---
# GENERATED from skills/review/evals/evals.json (id 1) by scripts/build-evals.mjs. Do not edit.
description: "review #1 (positive)"
tags: [review, positive]
plugins: ["../.."]
max_turns: 40
timeout_seconds: 900
allowed_tools: [Read, Glob, Grep, Skill, Agent, TodoWrite]
expected_outcome: "Uses an independent reviewer, never the implementer: a spec gate (spec hawk) then a quality panel of lenses in parallel, each applied only to repos it fits. Blocker/major findings route back to the implementer and are re-reviewed, bounded; a FAIL names at least one finding with path:line; always ends on a review. On PASS the PR is ready once every thread has an explicit resolution; next is crystallize."
---

Review PR #214 for EXPORT-2 before it merges.
