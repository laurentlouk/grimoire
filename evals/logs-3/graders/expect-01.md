---
type: llm
focus: trace
---

You are grading one run of the "logs" skill of a plugin, from its transcript.

The user's request was: "Review this PR before I merge it."

Expectation to check: Does not use the logs skill; routes to review

PASS if the transcript clearly shows the assistant meeting this expectation.
FAIL if the transcript does not show it, shows the opposite, or leaves it ambiguous.
Judge only this one expectation; ignore formatting and anything else the run did or did not do.

For context only (not a separate requirement), the intended behaviour overall: Reviewing a diff belongs to the review skill and the reviewer scout, not to the logs skill. The logs skill is not used: no events are read and no page is rendered.
