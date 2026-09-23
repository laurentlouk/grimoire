---
type: llm
focus: trace
---

You are grading one run of the "implement" skill of a plugin, from its transcript.

The user's request was: "Implement EXPORT-2 (slice 2, touches only the API repo)."

Expectation to check: Dispatches the owning team agent from AGENTS.md via launch-agent, with its memory pasted into the brief

PASS if the transcript clearly shows the assistant meeting this expectation.
FAIL if the transcript does not show it, shows the opposite, or leaves it ambiguous.
Judge only this one expectation; ignore formatting and anything else the run did or did not do.

For context only (not a separate requirement), the intended behaviour overall: Dispatches the team agent that owns the API repo from AGENTS.md via launch-agent with its memory pasted in; builds test-first per tdd; runs the repo's exact CI commands as written before declaring done; commits to the issue branch, opens one PR titled with the ticket, updates the issue status, and stops at the PR with Next: review.
