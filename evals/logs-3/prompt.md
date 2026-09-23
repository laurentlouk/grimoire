---
# GENERATED from skills/logs/evals/evals.json (id 3) by scripts/build-evals.mjs. Do not edit.
description: "logs #3 (negative)"
tags: [logs, negative]
plugins: ["../.."]
max_turns: 40
timeout_seconds: 900
allowed_tools: [Read, Glob, Grep, Skill, Agent, TodoWrite]
expected_outcome: "Reviewing a diff belongs to the review skill and the reviewer scout, not to the logs skill. The logs skill is not used: no events are read and no page is rendered."
---

Review this PR before I merge it.
