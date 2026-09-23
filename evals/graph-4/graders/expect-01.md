---
type: llm
focus: trace
---

You are grading one run of the "graph" skill of a plugin, from its transcript.

The user's request was: "Who calls Session.refresh?"

Expectation to check: Does not render the page for a single lookup

PASS if the transcript clearly shows the assistant meeting this expectation.
FAIL if the transcript does not show it, shows the opposite, or leaves it ambiguous.
Judge only this one expectation; ignore formatting and anything else the run did or did not do.

For context only (not a separate requirement), the intended behaviour overall: A narrow graph question is answered with the graph_callers tool (or a scout), then confirmed in the code; it does not need the HTML page, so the graph skill is not used.
