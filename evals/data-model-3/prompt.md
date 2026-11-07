---
# GENERATED from skills/data-model/evals/evals.json (id 3) by scripts/build-evals.mjs. Do not edit.
description: "data-model #3 (edge)"
tags: [data-model, edge]
plugins: ["../.."]
max_turns: 40
timeout_seconds: 900
allowed_tools: [Read, Glob, Grep, Skill, Agent, TodoWrite]
expected_outcome: "Looks for the line that ties the two names before claiming anything (where the local table name is set: a compose file, an env example, a test setup or seed script), reading graph_data's entity for both (the local one may say 'declared, no code uses this name'). With that evidence, adds an equivalences claim naming each declaration as written: { repo, name: Orders, path: dynamodb/tables/orders.json } and { repo, template: {env}-{project}-order }, with a why and the citation. Runs graph.mjs data check, then shows graph_data for the table: one logical table, refined, whose differences (billing, an index only one side declares) are conflicts with each declaration's path:line. Without such a line, says the local declaration may be stale and does not pair them by a guess unless the user confirms."
---

The local-dev table file dynamodb/tables/orders.json declares Orders, and prod Terraform has {env}-{project}-order. They're the same table: make the map compare them.
