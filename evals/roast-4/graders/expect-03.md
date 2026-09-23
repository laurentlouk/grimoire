---
type: llm
focus: trace
---

You are grading one run of the "roast" skill of a plugin, from its transcript.

The user's request was: "Roast moving session cleanup to a new scheme. docs/runbooks/sessions.md says a nightly cleanup job deletes expired sessions."

Expectation to check: Does not bend the design toward the stale document

PASS if the transcript clearly shows the assistant meeting this expectation.
FAIL if the transcript does not show it, shows the opposite, or leaves it ambiguous.
Judge only this one expectation; ignore formatting and anything else the run did or did not do.

For context only (not a separate requirement), the intended behaviour overall: Checks the code; when the code shows sessions expire through native TTL and no cleanup job exists, records a docs-drift item (what the doc says, what the code does, file and line for both), bases the design on the code, and fixes the runbook as part of the roast (or hands the fix to the implementer if it lives elsewhere), listing it under Docs drift fixed.
