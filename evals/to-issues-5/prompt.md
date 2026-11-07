---
# GENERATED from skills/to-issues/evals/evals.json (id 5) by scripts/build-evals.mjs. Do not edit.
description: "to-issues #5 (edge)"
tags: [to-issues, edge]
plugins: ["../.."]
max_turns: 40
timeout_seconds: 900
allowed_tools: [Read, Glob, Grep, Skill, Agent, TodoWrite]
expected_outcome: "Explores the code and reads the delta beside the spec. Proposes the numbered vertical slices, and each issue names the model changes of its slice from the delta, one line each with the change's id, the target, the op and why (for example `isbn` · add `api:db/books.isbn` · search by isbn), so the implementer inherits exactly which tables, columns, keys, indexes and foreign keys it touches. A change no slice owns goes back to to-plan; it never edits the delta. Waits for sign-off before creating anything."
---

The loans plan is agreed and its delta is docs/specs/2026-11-06-loans.delta.json (to-plan gave each change a slice). Break the plan into issues in the LOANS project.
