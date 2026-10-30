---
# GENERATED from skills/crystallize/evals/evals.json (id 8) by scripts/build-evals.mjs. Do not edit.
description: "crystallize #8 (edge)"
tags: [crystallize, edge]
plugins: ["../.."]
max_turns: 40
timeout_seconds: 900
allowed_tools: [Read, Glob, Grep, Skill, Agent, TodoWrite]
expected_outcome: "Patches the ui-states skill with the empty-state check and appends one eval case to skills/ui-states/evals/evals.json in the file's existing format (two-space indent, one-line expectation objects), leaving every other case byte-for-byte unchanged, so the diff shows only the new case. Regenerates the eval suite if the repository builds one from these files, runs its check, and lists the patch and the eval result in the crystallize report."
---

Crystallize web PR #140. The only lesson: the implementer forgot the empty-state check, so patch the ui-states skill and add an eval case for it. Its evals.json uses two-space indents with each expectation on one line.
