---
# GENERATED from skills/architecture/evals/evals.json (id 1) by scripts/build-evals.mjs. Do not edit.
description: "architecture #1 (positive)"
tags: [architecture, positive]
plugins: ["../.."]
max_turns: 40
timeout_seconds: 900
allowed_tools: [Read, Glob, Grep, Skill, Agent, TodoWrite]
expected_outcome: "Takes archify only as the user's reference for the look: never installs or calls it. Checks grimoire.config.json and that the graph has an index, then drafts with node <root>/tools/graph/graph.mjs architecture draft --out docs/architecture/<slug>.architecture.json. Refines the draft by reading the code (entry points, config, I/O call sites): names components by responsibility, sets types, adds datastores, queues and external APIs seen in config with sources, labels each connection with what flows and sets via where a line crosses a process. Runs graph.mjs architecture check until it reports no error and answers each warning, removes \"draft\": true, renders the page and opens it at the Architecture tab, and reports the file path, what the diagram shows and the check's result."
---

Draw the architecture of this project, like archify does: the services, the datastores and how they talk to each other.
