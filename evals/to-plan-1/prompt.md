---
# GENERATED from skills/to-plan/evals/evals.json (id 1) by scripts/build-evals.mjs. Do not edit.
description: "to-plan #1 (positive)"
tags: [to-plan, positive]
plugins: ["../.."]
max_turns: 40
timeout_seconds: 900
allowed_tools: [Read, Glob, Grep, Skill, Agent, TodoWrite]
expected_outcome: "Synthesizes without re-interviewing: chooses test seams (existing, highest, ideally one) and checks them with the user, then writes docs/plans/YYYY-MM-DD-topic-plan.md with the problem and solution in the user's words, numbered user stories 'as an [actor] I want [feature] so that [benefit]', the seams, and vertical slices smallest first; does not reopen spec decisions; hands the plan to to-issues."
---

Roast is done: docs/specs/2026-09-10-export-design.md is approved. Turn it into a plan.
