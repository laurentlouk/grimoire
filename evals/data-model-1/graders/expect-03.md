---
type: llm
focus: trace
---

You are grading one run of the "data-model" skill of a plugin, from its transcript.

The user's request was: "Our mobile app keeps events in SQLite and the backend stores them in a DynamoDB table. Map how the data flows between the stores, and document the Redis search index too: nothing reads it yet."

Expectation to check: Writes the claims in docs/architecture/<slug>.data.json: a lineage with field pairs and a stores entry with a path:line citation per field

PASS if the transcript clearly shows the assistant meeting this expectation.
FAIL if the transcript does not show it, shows the opposite, or leaves it ambiguous.
Judge only this one expectation; ignore formatting and anything else the run did or did not do.

For context only (not a separate requirement), the intended behaviour overall: Checks grimoire.config.json and the index, reads the extracted map with graph_data (stores, logical tables, item types, access leads, and the Gaps part listing the Redis client), then reads the code at each lead before claiming anything: the sync code that copies the device's events into the backend table (which field goes where), the code that creates the search index and its fields. Writes docs/architecture/<slug>.data.json with a lineage claim from the SQLite events entity to the DynamoDB table, field pairs and a citation to the sync line, and a stores entry describing the search index entity by entity with a repo:path:line per field and the client package in imports. Runs node <root>/tools/graph/graph.mjs data check until no claim drifts, renders the page and points to the Data tab (lineage drawn, the store as a card, each fact labelled refined), and reports the file, what it adds, and the gaps left.
