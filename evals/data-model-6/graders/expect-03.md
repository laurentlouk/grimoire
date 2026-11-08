---
type: llm
focus: trace
---

You are grading one run of the "data-model" skill of a plugin, from its transcript.

The user's request was: "Our backend reaches a production-only Postgres with raw SQL and no migrations; graph_data lists backend:sql (inferred, postgres). The app keeps orders in SQLite and uploads them there. Map that in the data model."

Expectation to check: Does not add a stores entry or a type to a described entity for the inferred store

PASS if the transcript clearly shows the assistant meeting this expectation.
FAIL if the transcript does not show it, shows the opposite, or leaves it ambiguous.
Judge only this one expectation; ignore formatting and anything else the run did or did not do.

For context only (not a separate requirement), the intended behaviour overall: Reads graph_data and recognises the inferred store as deduced from the queries the code sends: tables and columns seen, relations from joins, unique keys from ON CONFLICT, types and nullability unknown. It is read, so it is no gap and is not described again under stores. Reads the app's upload code and the backend's INSERT for orders, then writes a lineage from the app's SQLite orders entity to backend:sql (inferred, postgres)/orders with field pairs and citations to those lines, adds no stores entry for the deduced store and no type on a described entity for it, runs graph.mjs data check until no claim drifts, and points to the Data tab.
