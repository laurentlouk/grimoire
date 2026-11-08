---
# GENERATED from skills/data-model/evals/evals.json (id 1) by scripts/build-evals.mjs. Do not edit.
description: "data-model #1 (positive)"
tags: [data-model, positive]
plugins: ["../.."]
max_turns: 40
timeout_seconds: 900
allowed_tools: [Read, Glob, Grep, Skill, Agent, TodoWrite]
expected_outcome: "Checks grimoire.config.json and the index, reads the extracted map with graph_data (stores, logical tables, item types, access leads, and the cache's key space, whose search index says its schema is assembled in code, not read), then reads the code at each lead before claiming anything: the sync code that copies the device's events into the backend table (which field goes where), the functions that assemble the index's schema, field by field. Writes docs/architecture/<slug>.data.json with a lineage claim from the SQLite events entity to the DynamoDB table, field pairs and a citation to the sync line, and a stores entry (kind redisearch, an id no extractor gives) describing only the assembled fields, each at the line that pushes it, never a template, type or field the map already reads. Runs node <root>/tools/graph/graph.mjs data check until no claim drifts, renders the page and points to the Data tab (lineage drawn, the store as a card, each fact labelled refined), and reports the file, what it adds, and the gaps left."
---

Our mobile app keeps events in SQLite and the backend stores them in a DynamoDB table. Map how the data flows between the stores, and document our search index too: the code assembles its schema at run time.
