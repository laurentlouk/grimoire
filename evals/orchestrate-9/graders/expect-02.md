---
type: llm
focus: trace
---

You are grading one run of the "orchestrate" skill of a plugin, from its transcript.

The user's request was: "The EXPORT run halted overnight with \"environment: commit:api timed out after 30 s\". What now?"

Expectation to check: Says the commit-signing agent must be unlocked or approved, and that a signed commit is checked to work, before relaunching

PASS if the transcript clearly shows the assistant meeting this expectation.
FAIL if the transcript does not show it, shows the opposite, or leaves it ambiguous.
Judge only this one expectation; ignore formatting and anything else the run did or did not do.

For context only (not a separate requirement), the intended behaviour overall: Treats the halt as a machine state, not failed code: points at the status comment on the repo's draft PR (the halt reason, what landed, the fix) and the environment fix first (unlock or approve the commit-signing agent and confirm a signed commit works), then relaunches by state with the same runId and resumeState from a fresh run.json, without resumeFromRunId and without starting from scratch.
