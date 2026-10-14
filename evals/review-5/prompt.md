---
# GENERATED from skills/review/evals/evals.json (id 5) by scripts/build-evals.mjs. Do not edit.
description: "review #5 (edge)"
tags: [review, edge]
plugins: ["../.."]
max_turns: 40
timeout_seconds: 900
allowed_tools: [Read, Glob, Grep, Skill, Agent, TodoWrite]
expected_outcome: "Reviews the fix's own diff, not only the whole change, and does not pass it: the loosened assertion and the skipped test weaken tests that existed before the fix, and the finding (a crash) asked for neither, so each is a blocker on tests/export.test.ts, routed back to the implementer for another fix that makes the code meet the original tests."
---

Re-review PROJ-12 after the implementer's fix. The blocking finding was 'exporting an account with no rows crashes (src/export.ts:40)'. The fix commit changes src/export.ts, and in tests/export.test.ts it replaces expect(rows).toHaveLength(0) with expect(rows).toBeDefined() and marks 'exports an empty file' as it.skip. The implementer says the crash is fixed. Pass it if it is.
