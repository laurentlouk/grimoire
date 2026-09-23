---
type: llm
focus: trace
---

You are grading one run of the "tdd" skill of a plugin, from its transcript.

The user's request was: "Implement EXPORT-2 end to end through the API engineer and open the PR."

Expectation to check: Does not treat it as a standalone tdd session

PASS if the transcript clearly shows the assistant meeting this expectation.
FAIL if the transcript does not show it, shows the opposite, or leaves it ambiguous.
Judge only this one expectation; ignore formatting and anything else the run did or did not do.

For context only (not a separate requirement), the intended behaviour overall: Building a tracker issue end to end and opening a PR is `implement` (which applies tdd inside it), not tdd on its own.
