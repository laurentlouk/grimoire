---
type: llm
focus: trace
---

You are grading one run of the "implement" skill of a plugin, from its transcript.

The user's request was: "Implement EXPORT-7. The ticket says 'use the standard pagination' but doesn't say which one."

Expectation to check: Explores the code, contracts and docs for the existing pagination convention before asking

PASS if the transcript clearly shows the assistant meeting this expectation.
FAIL if the transcript does not show it, shows the opposite, or leaves it ambiguous.
Judge only this one expectation; ignore formatting and anything else the run did or did not do.

For context only (not a separate requirement), the intended behaviour overall: The implementer first explores the code, contracts and docs for the project's pagination convention; if it is still unclear it returns NEEDS_CONTEXT with one specific question naming what it checked. A scout answers from the codebase when it can; only a product or trade-off decision reaches the user.
