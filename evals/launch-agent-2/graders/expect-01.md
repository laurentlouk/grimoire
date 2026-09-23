---
type: llm
focus: trace
---

You are grading one run of the "launch-agent" skill of a plugin, from its transcript.

The user's request was: "The plan is agreed; break it into tracker issues."

Expectation to check: Does not dispatch a team agent or scout

PASS if the transcript clearly shows the assistant meeting this expectation.
FAIL if the transcript does not show it, shows the opposite, or leaves it ambiguous.
Judge only this one expectation; ignore formatting and anything else the run did or did not do.

For context only (not a separate requirement), the intended behaviour overall: Slicing a plan into issues is `to-issues`; no agent needs launching from the roster.
