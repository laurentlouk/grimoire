---
# GENERATED from skills/architecture/evals/evals.json (id 5) by scripts/build-evals.mjs. Do not edit.
description: "architecture #5 (edge)"
tags: [architecture, edge]
plugins: ["../.."]
max_turns: 40
timeout_seconds: 900
allowed_tools: [Read, Glob, Grep, Skill, Agent, TodoWrite]
expected_outcome: "Treats it as a slice: drafts (or starts from the existing diagram), keeps only the components on the checkout path, adds trust boundaries (kind trust) found in the auth code or config, marks the main path with the emphasis variant and cross-repository calls with via, says in a card what was left out, checks it, then renders and shows the Route tracing between the entry and the store."
---

Show me how the checkout path flows through our repos, with the trust boundaries.
