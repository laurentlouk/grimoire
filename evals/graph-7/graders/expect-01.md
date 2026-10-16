---
type: llm
focus: trace
---

You are grading one run of the "graph" skill of a plugin, from its transcript.

The user's request was: "Draw me an architecture diagram of this repo."

Expectation to check: Uses the architecture skill's draft, refine and check steps instead of only rendering the graph page

PASS if the transcript clearly shows the assistant meeting this expectation.
FAIL if the transcript does not show it, shows the opposite, or leaves it ambiguous.
Judge only this one expectation; ignore formatting and anything else the run did or did not do.

For context only (not a separate requirement), the intended behaviour overall: Drawing a diagram is the architecture skill's job (draft, refine from the code, check); the graph skill only renders the page that shows it.
