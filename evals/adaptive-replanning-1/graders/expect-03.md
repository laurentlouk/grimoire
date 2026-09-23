---
type: llm
focus: trace
---

You are grading one run of the "adaptive-replanning" skill of a plugin, from its transcript.

The user's request was: "Explain why the loop replanned slice 3 after the fix attempts on its second task ran out."

Expectation to check: States that the failure's cause is fed into the replan so the next path is different

PASS if the transcript clearly shows the assistant meeting this expectation.
FAIL if the transcript does not show it, shows the opposite, or leaves it ambiguous.
Judge only this one expectation; ignore formatting and anything else the run did or did not do.

For context only (not a separate requirement), the intended behaviour overall: Distinguishes the inner fix loop (same task, retried with findings, bounded attempts) from the outer replan loop (whole remaining plan, bounded by the replan budget); explains the replan starts from the current state, leaves finished work untouched, feeds the failure's cause in, and returns revised tasks in the same shape or a reasoned stop.
