---
# GENERATED from skills/review/evals/evals.json (id 8) by scripts/build-evals.mjs. Do not edit.
description: "review #8 (edge)"
tags: [review, edge]
plugins: ["../.."]
max_turns: 40
timeout_seconds: 900
allowed_tools: [Read, Glob, Grep, Skill, Agent, TodoWrite]
expected_outcome: "Does not raise the unplanned index as a finding just because the delta does not plan it: the implementer kept it with a reason, the PR lists it and the user acknowledges it later. Judges the dropped column on its merits: another repository still reads it, so dropping it is a blocker or major finding at path:line, whatever the delta says."
---

Review the PR for LOANS-3. The diff adds an index on loans.due that the design's delta does not plan (the implementer kept it: the overdue list queries by due date), and it drops the books.legacy_code column, which the export job in the reports repository still selects.
