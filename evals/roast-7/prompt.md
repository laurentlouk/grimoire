---
# GENERATED from skills/roast/evals/evals.json (id 7) by scripts/build-evals.mjs. Do not edit.
description: "roast #7 (edge)"
tags: [roast, edge]
plugins: ["../.."]
max_turns: 40
timeout_seconds: 900
allowed_tools: [Read, Glob, Grep, Skill, Agent, TodoWrite]
expected_outcome: "Reads the current data model first (graph_data, the migrations) and settles the design one question at a time. Because the design changes stored data, it drafts docs/specs/YYYY-MM-DD-<topic>.delta.json beside the spec: schema 1, the spec path, a data array with one change per element (for example an add of mobile:drizzle/loans.reminded_at with after { type, nullable } and an add of the mobile:drizzle/reminder_rules table with its fields), each with an id, op, target in the grammar, why and origin planned, no slice, and architecture []. It checks the file with graph.mjs changes --delta (every change pending at design time), asks the user to validate it in the Data tab under graph.mjs serve and acknowledge each change, and lists the delta in the spec."
---

Roast loan reminders for the mobile app: we need to remember when a reminder was sent for each loan, and probably a table of reminder rules. Its SQLite migrations are in mobile/drizzle.
