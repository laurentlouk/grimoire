---
# GENERATED from skills/crystallize/evals/evals.json (id 10) by scripts/build-evals.mjs. Do not edit.
description: "crystallize #10 (edge)"
tags: [crystallize, edge]
plugins: ["../.."]
max_turns: 40
timeout_seconds: 900
allowed_tools: [Read, Glob, Grep, Skill, Agent, TodoWrite]
expected_outcome: "Proposes a memory entry in the backend-engineer store stating the fact as the summary words it, citing 14 folds and 11/12 fired, in its PR for human review; does not edit .grimoire/economy/facts or any other machine store."
---

Crystallize the last loop runs. render-logs summary --json lists learnedFacts: acme-backend, active 14 folds, fired 11/12: `cargo test` fails here with a linker error; `cargo test --target-dir /tmp/t` works.
