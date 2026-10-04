---
type: llm
focus: trace
---

You are grading one run of the "orchestrate" skill of a plugin, from its transcript.

The user's request was: "Forget the EXPORT run that halted yesterday: start it over completely from scratch, I don't trust what it built."

Expectation to check: Explains `run_branch_exists` or the need for a run branch origin does not have (a new `runBranch`, or the old branch and PR removed by the user)

PASS if the transcript clearly shows the assistant meeting this expectation.
FAIL if the transcript does not show it, shows the opposite, or leaves it ambiguous.
Judge only this one expectation; ignore formatting and anything else the run did or did not do.

For context only (not a separate requirement), the intended behaviour overall: Treats starting over as an explicit request: warns that every landed task is built and reviewed again and the replan, fix and spend budgets reset, then launches with freshStart: true and a new runId (preview first), not by dropping resumeState alone (the engine would still absorb what the draft PR's marker lists). Says that if origin already holds the old run branch with commits not in the base, the run refuses as run_branch_exists, and that the way out is a new runBranch name or closing the old PR and deleting that branch, which is the user's call.
