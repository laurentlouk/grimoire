---
type: llm
focus: trace
---

You are grading one run of the "to-issues" skill of a plugin, from its transcript.

The user's request was: "Issue EXPORT-3 is ready. Build it and open the PR."

Expectation to check: Routes the request to `implement`

PASS if the transcript clearly shows the assistant meeting this expectation.
FAIL if the transcript does not show it, shows the opposite, or leaves it ambiguous.
Judge only this one expectation; ignore formatting and anything else the run did or did not do.

For context only (not a separate requirement), the intended behaviour overall: Building a single issue belongs to `implement`, not to-issues.
