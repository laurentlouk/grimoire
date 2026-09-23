---
type: llm
focus: trace
---

You are grading one run of the "graph" skill of a plugin, from its transcript.

The user's request was: "Show me the code graph of this project so I can see what depends on what."

Expectation to check: Opens the printed file locally with open or xdg-open

PASS if the transcript clearly shows the assistant meeting this expectation.
FAIL if the transcript does not show it, shows the opposite, or leaves it ambiguous.
Judge only this one expectation; ignore formatting and anything else the run did or did not do.

For context only (not a separate requirement), the intended behaviour overall: Finds the plugin root two directories above the SKILL.md, runs node <root>/tools/graph/graph.mjs render from the project root (which refreshes the index first), takes the path it prints (default .grimoire/graph/graph.html) and opens it locally with open or xdg-open. Says the page is a map and stays local.
