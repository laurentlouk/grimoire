---
# GENERATED from skills/architecture/evals/evals.json (id 6) by scripts/build-evals.mjs. Do not edit.
description: "architecture #6 (edge)"
tags: [architecture, edge]
plugins: ["../.."]
max_turns: 40
timeout_seconds: 900
allowed_tools: [Read, Glob, Grep, Skill, Agent, TodoWrite]
expected_outcome: "Treats it as an unplanned architectural impact of the branch, never a reason to block. Reads the code that makes the link (the import from the web module into the store), then updates the existing diagram in docs/architecture in the same branch: draws the line web → store with what flows on it (or says in via what carries it), edits in place rather than re-drafting, and runs graph.mjs architecture check until it passes. When the work has a design delta beside its spec, appends the kept change to it as { id, op: add, target: connection:web->store, after, why, slice, origin: unplanned } with tools/graph/delta-append.mjs, never acknowledged. Tells the user in one message what the branch changed in the architecture and what was done with it, pointing to the Architecture tab under graph.mjs serve to see it and acknowledge it."
---

graph_changes on my branch ends with an Architecture part: 'web uses store (2 file pairs in the graph), but no line is drawn between them'. The PR is about to go out. Deal with it.
