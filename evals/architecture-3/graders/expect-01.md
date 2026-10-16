---
type: llm
focus: trace
---

You are grading one run of the "architecture" skill of a plugin, from its transcript.

The user's request was: "Who calls OrderService.place?"

Expectation to check: Does not draft or edit an architecture diagram

PASS if the transcript clearly shows the assistant meeting this expectation.
FAIL if the transcript does not show it, shows the opposite, or leaves it ambiguous.
Judge only this one expectation; ignore formatting and anything else the run did or did not do.

For context only (not a separate requirement), the intended behaviour overall: A narrow call question is answered with the graph_callers tool (or a scout) and confirmed in the code. No architecture diagram is drafted or edited.
