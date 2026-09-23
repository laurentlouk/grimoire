---
type: llm
focus: trace
---

You are grading one run of the "implement" skill of a plugin, from its transcript.

The user's request was: "The PR for EXPORT-2 is open. Check it does exactly what the ticket says and meets our quality bar."

Expectation to check: Routes the request to `review`

PASS if the transcript clearly shows the assistant meeting this expectation.
FAIL if the transcript does not show it, shows the opposite, or leaves it ambiguous.
Judge only this one expectation; ignore formatting and anything else the run did or did not do.

For context only (not a separate requirement), the intended behaviour overall: Gating an open PR is `review`'s job, with an independent reviewer; the implementer never reviews its own work.
