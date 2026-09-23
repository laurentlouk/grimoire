---
# GENERATED from skills/crystallize/evals/evals.json (id 3) by scripts/build-evals.mjs. Do not edit.
description: "crystallize #3 (edge)"
tags: [crystallize, edge]
plugins: ["../.."]
max_turns: 40
timeout_seconds: 900
allowed_tools: [Read, Glob, Grep, Skill, Agent, TodoWrite]
expected_outcome: "Identifies a docs-drift signal: updates the retention document to match the code and records it under 'Docs synced'; judges that no new procedure or fact warrants a skill or memory change and says so under 'Declined, and why'; still writes the report and opens the PR."
---

Crystallize infra PR #77. The only review comment was a human noting that our retention doc still describes the old cleanup worker, but the code has used native TTL for months. Nothing else notable.
