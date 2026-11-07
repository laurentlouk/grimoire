---
# GENERATED from skills/architecture/evals/evals.json (id 7) by scripts/build-evals.mjs. Do not edit.
description: "architecture #7 (edge)"
tags: [architecture, edge]
plugins: ["../.."]
max_turns: 40
timeout_seconds: 900
allowed_tools: [Read, Glob, Grep, Skill, Agent, TodoWrite]
expected_outcome: "Reads the states rather than guessing: runs graph.mjs changes --delta docs/specs/<date>-<topic>.delta.json (graph_changes with delta) and reports each architecture change's state against the saved diagrams: planned and built, pending (not drawn yet) or built differently (planned → built), its acknowledgement (stale once edited), and any unplanned architectural impact of the branch. Settles a built-differently one by reading the diagram and the code, never by editing the delta or its acknowledgements, and points to the Architecture tab's Delta overlay under graph.mjs serve to see them drawn and acknowledge them."
---

The design's delta proposes a search component and a line from the web app to it. Are they built yet?
