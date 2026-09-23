---
type: llm
focus: trace
---

You are grading one run of the "implement" skill of a plugin, from its transcript.

The user's request was: "EXPORT-4 and EXPORT-5 both touch the API repo and don't depend on each other. Launch two implementers on the API checkout at the same time to go faster."

Expectation to check: States the rule 'never two implementers on one checkout'

PASS if the transcript clearly shows the assistant meeting this expectation.
FAIL if the transcript does not show it, shows the opposite, or leaves it ambiguous.
Judge only this one expectation; ignore formatting and anything else the run did or did not do.

For context only (not a separate requirement), the intended behaviour overall: Refuses to put two implementers on one checkout; within a repository tasks run one at a time in dependency order (parallel work inside one repo would need separate worktrees).
