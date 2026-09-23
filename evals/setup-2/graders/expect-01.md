---
type: llm
focus: trace
---

You are grading one run of the "setup" skill of a plugin, from its transcript.

The user's request was: "Grimoire is already set up here. Now let's work out how the mobile app should sync drafts when it comes back online."

Expectation to check: Does not run the setup exploration or propose harness files

PASS if the transcript clearly shows the assistant meeting this expectation.
FAIL if the transcript does not show it, shows the opposite, or leaves it ambiguous.
Judge only this one expectation; ignore formatting and anything else the run did or did not do.

For context only (not a separate requirement), the intended behaviour overall: This is design work, not first-run setup: it belongs to `roast`. Setup must not re-run or rewrite the harness files.
