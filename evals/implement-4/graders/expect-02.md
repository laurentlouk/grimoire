---
type: llm
focus: trace
---

You are grading one run of the "implement" skill of a plugin, from its transcript.

The user's request was: "Implement EXPORT-6 in the mobile repo. That repo has an emulator test suite the orchestrator owns as its gate."

Expectation to check: The implementer does not open the mobile repo's PR

PASS if the transcript clearly shows the assistant meeting this expectation.
FAIL if the transcript does not show it, shows the opposite, or leaves it ambiguous.
Judge only this one expectation; ignore formatting and anything else the run did or did not do.

For context only (not a separate requirement), the intended behaviour overall: The implementer never runs the owned gate and never opens that repo's PR: it finishes the whole change, makes the final commit and reports DONE_PENDING_GATE; the orchestrator runs the gate once on the final committed tree and opens the PR on green.
