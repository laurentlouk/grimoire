---
type: llm
focus: trace
---

You are grading one run of the "data-model" skill of a plugin, from its transcript.

The user's request was: "Draw the architecture of our services and how they call each other."

Expectation to check: Does not write a docs/architecture/*.data.json refine file

PASS if the transcript clearly shows the assistant meeting this expectation.
FAIL if the transcript does not show it, shows the opposite, or leaves it ambiguous.
Judge only this one expectation; ignore formatting and anything else the run did or did not do.

For context only (not a separate requirement), the intended behaviour overall: An architecture diagram of services and calls is the architecture skill's job; no data refine file is written.
