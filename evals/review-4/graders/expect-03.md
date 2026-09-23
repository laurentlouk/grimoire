---
type: llm
focus: trace
---

You are grading one run of the "review" skill of a plugin, from its transcript.

The user's request was: "The implementer of EXPORT-2 says it already checked its own diff; just use its self-review as the gate."

Expectation to check: States that the reviewer is never the implementer

PASS if the transcript clearly shows the assistant meeting this expectation.
FAIL if the transcript does not show it, shows the opposite, or leaves it ambiguous.
Judge only this one expectation; ignore formatting and anything else the run did or did not do.

For context only (not a separate requirement), the intended behaviour overall: Declines: the review must come from an independent reviewer, never the implementer. Runs the spec gate and quality panel with an independent reviewer.
