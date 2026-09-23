---
# GENERATED from skills/crystallize/evals/evals.json (id 2) by scripts/build-evals.mjs. Do not edit.
description: "crystallize #2 (negative)"
tags: [crystallize, negative]
plugins: ["../.."]
max_turns: 40
timeout_seconds: 900
allowed_tools: [Read, Glob, Grep, Skill, Agent, TodoWrite]
expected_outcome: "Crystallize runs after the PR exists and its threads are settled (or after merge), because the review threads are its main input. Proceed to review and PR first; crystallize afterwards."
---

The mobile implementer just reported DONE on issue 640. Capture the learnings now, before the PR.
