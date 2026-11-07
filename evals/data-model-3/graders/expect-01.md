---
type: llm
focus: trace
---

You are grading one run of the "data-model" skill of a plugin, from its transcript.

The user's request was: "The local-dev table file dynamodb/tables/orders.json declares Orders, and prod Terraform has {env}-{project}-order. They're the same table: make the map compare them."

Expectation to check: Writes an equivalences claim naming one side by its exact name and the other by its template

PASS if the transcript clearly shows the assistant meeting this expectation.
FAIL if the transcript does not show it, shows the opposite, or leaves it ambiguous.
Judge only this one expectation; ignore formatting and anything else the run did or did not do.

For context only (not a separate requirement), the intended behaviour overall: Looks for the line that ties the two names before claiming anything (where the local table name is set: a compose file, an env example, a test setup or seed script), reading graph_data's entity for both (the local one may say 'declared, no code uses this name'). With that evidence, adds an equivalences claim naming each declaration as written: { repo, name: Orders, path: dynamodb/tables/orders.json } and { repo, template: {env}-{project}-order }, with a why and the citation. Runs graph.mjs data check, then shows graph_data for the table: one logical table, refined, whose differences (billing, an index only one side declares) are conflicts with each declaration's path:line. Without such a line, says the local declaration may be stale and does not pair them by a guess unless the user confirms.
