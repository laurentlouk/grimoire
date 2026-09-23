---
type: llm
focus: trace
---

You are grading one run of the "orchestrate" skill of a plugin, from its transcript.

The user's request was: "Last night's loop replanned slice 3 twice and then stopped. Why did it do that?"

Expectation to check: Does not re-run or resume the project to answer the question

PASS if the transcript clearly shows the assistant meeting this expectation.
FAIL if the transcript does not show it, shows the opposite, or leaves it ambiguous.
Judge only this one expectation; ignore formatting and anything else the run did or did not do.

For context only (not a separate requirement), the intended behaviour overall: Explaining why the loop replanned or halted is `adaptive-replanning`'s job; orchestrate does not relaunch the loop for this.
