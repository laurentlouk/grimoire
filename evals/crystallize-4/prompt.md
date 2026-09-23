---
# GENERATED from skills/crystallize/evals/evals.json (id 4) by scripts/build-evals.mjs. Do not edit.
description: "crystallize #4 (edge)"
tags: [crystallize, edge]
plugins: ["../.."]
max_turns: 40
timeout_seconds: 900
allowed_tools: [Read, Glob, Grep, Skill, Agent, TodoWrite]
expected_outcome: "Treats the cross-run telemetry as evidence alongside the PR threads and run ledgers: gets the cross-run aggregate from `render-logs.mjs summary --json` (reading the runs' events/*.jsonl chunks only to drill into a case), compares only runs with the same grimoire version / briefs hash, counts guard-passed fixes later re-flagged by the terminal sweep and haiku-routed tasks with 2+ fix rounds. Proposes a patch to the guard brief and to the routing rubric in the hydrate brief (briefs count as skills), cites the event counts in the report, gates the brief edits with evals, and does not change the loop's engine code."
---

Crystallize the EXPORT run's PRs. Also look at the loop's local event logs under .grimoire/runs/: across the last several runs tagged with the same grimoire version, the post-fix guard passed fixes that the terminal sweep later re-flagged, and tasks routed to haiku needed 2+ fix rounds.
