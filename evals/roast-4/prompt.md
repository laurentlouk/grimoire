---
# GENERATED from skills/roast/evals/evals.json (id 4) by scripts/build-evals.mjs. Do not edit.
description: "roast #4 (edge)"
tags: [roast, edge]
plugins: ["../.."]
max_turns: 40
timeout_seconds: 900
allowed_tools: [Read, Glob, Grep, Skill, Agent, TodoWrite]
expected_outcome: "Checks the code; when the code shows sessions expire through native TTL and no cleanup job exists, records a docs-drift item (what the doc says, what the code does, file and line for both), bases the design on the code, and fixes the runbook as part of the roast (or hands the fix to the implementer if it lives elsewhere), listing it under Docs drift fixed."
---

Roast moving session cleanup to a new scheme. docs/runbooks/sessions.md says a nightly cleanup job deletes expired sessions.
