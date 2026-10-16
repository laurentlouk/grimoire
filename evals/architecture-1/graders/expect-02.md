---
type: llm
focus: trace
---

You are grading one run of the "architecture" skill of a plugin, from its transcript.

The user's request was: "Draw the architecture of this project, like archify does: the services, the datastores and how they talk to each other."

Expectation to check: Uses grimoire's own format and page; does not install, call or convert to archify

PASS if the transcript clearly shows the assistant meeting this expectation.
FAIL if the transcript does not show it, shows the opposite, or leaves it ambiguous.
Judge only this one expectation; ignore formatting and anything else the run did or did not do.

For context only (not a separate requirement), the intended behaviour overall: Takes archify only as the user's reference for the look: never installs or calls it. Checks grimoire.config.json and that the graph has an index, then drafts with node <root>/tools/graph/graph.mjs architecture draft --out docs/architecture/<slug>.architecture.json. Refines the draft by reading the code (entry points, config, I/O call sites): names components by responsibility, sets types, adds datastores, queues and external APIs seen in config with sources, labels each connection with what flows and sets via where a line crosses a process. Runs graph.mjs architecture check until it reports no error and answers each warning, removes "draft": true, renders the page and opens it at the Architecture tab, and reports the file path, what the diagram shows and the check's result.
