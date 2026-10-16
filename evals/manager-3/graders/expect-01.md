---
type: llm
focus: trace
---

You are grading one run of the "manager" skill of a plugin, from its transcript.

The user's request was: "Build this whole project unattended, all of its slices."

Expectation to check: Does not use the manager skill; routes to orchestrate

PASS if the transcript clearly shows the assistant meeting this expectation.
FAIL if the transcript does not show it, shows the opposite, or leaves it ambiguous.
Judge only this one expectation; ignore formatting and anything else the run did or did not do.

For context only (not a separate requirement), the intended behaviour overall: Building a tracker project unattended is the orchestrate skill's job (the build loop), not the manager's. The manager skill is not used: no briefing is produced and scripts/manager.mjs is not run.
