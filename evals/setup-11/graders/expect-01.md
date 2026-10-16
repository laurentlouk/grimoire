---
type: llm
focus: trace
---

You are grading one run of the "setup" skill of a plugin, from its transcript.

The user's request was: "Grimoire and its manager block are set up. What's urgent in our Linear today, and what can we hand to AI?"

Expectation to check: Does not run the setup exploration or propose a manager block or any other harness file

PASS if the transcript clearly shows the assistant meeting this expectation.
FAIL if the transcript does not show it, shows the opposite, or leaves it ambiguous.
Judge only this one expectation; ignore formatting and anything else the run did or did not do.

For context only (not a separate requirement), the intended behaviour overall: This asks for the briefing, not for setup: it belongs to the manager skill. Setup must not run its exploration, re-bind the sources or propose any file.
