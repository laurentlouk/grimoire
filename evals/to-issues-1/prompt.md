---
# GENERATED from skills/to-issues/evals/evals.json (id 1) by scripts/build-evals.mjs. Do not edit.
description: "to-issues #1 (positive)"
tags: [to-issues, positive]
plugins: ["../.."]
max_turns: 40
timeout_seconds: 900
allowed_tools: [Read, Glob, Grep, Skill, Agent, TodoWrite]
expected_outcome: "Explores the affected code first; proposes a numbered list of thin vertical slices (title in the project's vocabulary, who builds it, exact files, success criteria, dependencies, order smallest first); waits for sign-off; then creates one issue at a time, linked to the parent project, tagged with its slice number, with blocks/is-blocked-by links."
---

The plan at docs/plans/2026-09-12-export-plan.md is agreed. Break it into issues in the tracker under the EXPORT project.
