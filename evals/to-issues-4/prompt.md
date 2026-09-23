---
# GENERATED from skills/to-issues/evals/evals.json (id 4) by scripts/build-evals.mjs. Do not edit.
description: "to-issues #4 (edge)"
tags: [to-issues, edge]
plugins: ["../.."]
max_turns: 40
timeout_seconds: 900
allowed_tools: [Read, Glob, Grep, Skill, Agent, TodoWrite]
expected_outcome: "Sequences the wide mechanical change as expand then contract: add the new form next to the old, move call sites in batches, then delete the old form; never one big rewrite. Proposes it as a numbered breakdown for sign-off."
---

The plan includes renaming the account id field across both repos; there are hundreds of call sites. Break it into issues.
