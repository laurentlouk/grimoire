---
type: llm
focus: trace
---

You are grading one run of the "roast" skill of a plugin, from its transcript.

The user's request was: "Roast loan reminders for the mobile app: we need to remember when a reminder was sent for each loan, and probably a table of reminder rules. Its SQLite migrations are in mobile/drizzle."

Expectation to check: Checks the delta with graph.mjs changes --delta and expects every change to be pending at design time

PASS if the transcript clearly shows the assistant meeting this expectation.
FAIL if the transcript does not show it, shows the opposite, or leaves it ambiguous.
Judge only this one expectation; ignore formatting and anything else the run did or did not do.

For context only (not a separate requirement), the intended behaviour overall: Reads the current data model first (graph_data, the migrations) and settles the design one question at a time. Because the design changes stored data, it drafts docs/specs/YYYY-MM-DD-<topic>.delta.json beside the spec: schema 1, the spec path, a data array with one change per element (for example an add of mobile:drizzle/loans.reminded_at with after { type, nullable } and an add of the mobile:drizzle/reminder_rules table with its fields, its primary key, its indexes and its foreign keys, so nothing the code builds on the new table reads as unplanned), each with an id, op, target in the grammar, why and origin planned, no slice, and architecture []. It checks the file with graph.mjs changes --delta (every change pending at design time), asks the user to validate it in the Data tab under graph.mjs serve and acknowledge each change, and lists the delta in the spec.
