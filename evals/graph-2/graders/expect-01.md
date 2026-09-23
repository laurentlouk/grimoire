---
type: llm
focus: trace
---

You are grading one run of the "graph" skill of a plugin, from its transcript.

The user's request was: "Rebuild the graph index, it's never been built here."

Expectation to check: Builds the index with the graph.mjs index script, not by reading files and extracting relations itself

PASS if the transcript clearly shows the assistant meeting this expectation.
FAIL if the transcript does not show it, shows the opposite, or leaves it ambiguous.
Judge only this one expectation; ignore formatting and anything else the run did or did not do.

For context only (not a separate requirement), the intended behaviour overall: Checks grimoire.config.json for graph.enabled, runs node <root>/tools/graph/graph.mjs index (the script, not a model reading files), notes that the first run installs the parser runtime once per machine, and reports the per-repo counts it prints. Offers to render the page afterwards.
