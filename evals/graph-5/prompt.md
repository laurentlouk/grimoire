---
# GENERATED from skills/graph/evals/evals.json (id 5) by scripts/build-evals.mjs. Do not edit.
description: "graph #5 (edge)"
tags: [graph, edge]
plugins: ["../.."]
max_turns: 40
timeout_seconds: 900
allowed_tools: [Read, Glob, Grep, Skill, Agent, TodoWrite]
expected_outcome: "Renders the page with graph.mjs render and opens it locally. Points the user at the Map tab's system map (one lane per repository, modules linked by the file pairs that use each other) and at the symbol's neighbourhood (search it, or the #sym-<id> anchor): callers on the left, callees on the right, test code and ambiguous links hidden until their toggles are on. Reminds that links are matched by name and confirms anything it states in the code at the path:line."
---

Open the code graph and show me how the backend's modules depend on each other, and what calls StreamWrapper.send_message.
