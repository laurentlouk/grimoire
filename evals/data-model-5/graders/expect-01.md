---
type: llm
focus: trace
---

You are grading one run of the "data-model" skill of a plugin, from its transcript.

The user's request was: "Add a nullable `archived_at` column to the events table with a migration."

Expectation to check: Does not run graph.mjs data check or edit a refine file as the way to make the change

PASS if the transcript clearly shows the assistant meeting this expectation.
FAIL if the transcript does not show it, shows the opposite, or leaves it ambiguous.
Judge only this one expectation; ignore formatting and anything else the run did or did not do.

For context only (not a separate requirement), the intended behaviour overall: A schema change is code work (a migration, through implement or the migration engineer); the data model refine skill is not used and no refine file is edited.
