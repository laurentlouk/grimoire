---
type: llm
focus: trace
---

You are grading one run of the "to-plan" skill of a plugin, from its transcript.

The user's request was: "I have a rough idea for CSV export but nothing is decided yet. Can you write a plan for it?"

Expectation to check: Routes the request to `roast` because no approved design spec exists

PASS if the transcript clearly shows the assistant meeting this expectation.
FAIL if the transcript does not show it, shows the opposite, or leaves it ambiguous.
Judge only this one expectation; ignore formatting and anything else the run did or did not do.

For context only (not a separate requirement), the intended behaviour overall: No approved spec exists; the idea must go through `roast` first. to-plan only synthesizes what roast settled.
