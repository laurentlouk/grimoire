---
# GENERATED from skills/data-model/evals/evals.json (id 6) by scripts/build-evals.mjs. Do not edit.
description: "data-model #6 (edge)"
tags: [data-model, edge]
plugins: ["../.."]
max_turns: 40
timeout_seconds: 900
allowed_tools: [Read, Glob, Grep, Skill, Agent, TodoWrite]
expected_outcome: "Reads graph_data and recognises the inferred store as deduced from the queries the code sends: tables and columns seen, relations from joins, unique keys from ON CONFLICT, types and nullability unknown. It is read, so it is no gap and is not described again under stores. Reads the app's upload code and the backend's INSERT for orders, then writes a lineage from the app's SQLite orders entity to backend:sql (inferred, postgres)/orders with field pairs and citations to those lines, claims no type or nullability for the deduced columns, runs graph.mjs data check until no claim drifts, and points to the Data tab."
---

Our backend reaches a production-only Postgres with raw SQL and no migrations; graph_data lists backend:sql (inferred, postgres). The app keeps orders in SQLite and uploads them there. Map that in the data model.
