---
type: llm
focus: trace
---

You are grading one run of the "review" skill of a plugin, from its transcript.

The user's request was: "The review panel on PR #214 came back with two minor findings and three nits, no blockers or majors. Send it back for another round so it's perfect."

Expectation to check: Treats only blocker and major findings as failing

PASS if the transcript clearly shows the assistant meeting this expectation.
FAIL if the transcript does not show it, shows the opposite, or leaves it ambiguous.
Judge only this one expectation; ignore formatting and anything else the run did or did not do.

For context only (not a separate requirement), the intended behaviour overall: Severity is a gate: minor and nit are recorded for the human and never buy a rework round. The review passes (given the spec gate passed); no fix round is dispatched.
