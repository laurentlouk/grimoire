---
type: llm
focus: trace
---

You are grading one run of the "launch-agent" skill of a plugin, from its transcript.

The user's request was: "Send scouts to find where exports are serialized and which endpoints paginate."

Expectation to check: Dispatches both scouts in one message so they run in parallel

PASS if the transcript clearly shows the assistant meeting this expectation.
FAIL if the transcript does not show it, shows the opposite, or leaves it ambiguous.
Judge only this one expectation; ignore formatting and anything else the run did or did not do.

For context only (not a separate requirement), the intended behaviour overall: Dispatches two independent read-only scouts in one message so they run together; scouts get no memory; each brief carries the explore-before-asking rule.
