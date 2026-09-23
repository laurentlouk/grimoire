---
type: llm
focus: trace
---

You are grading one run of the "tdd" skill of a plugin, from its transcript.

The user's request was: "For the new pricing module, write the full test suite up front, all the cases, then we'll write the code."

Expectation to check: Explains that bulk tests only check imagined behaviour

PASS if the transcript clearly shows the assistant meeting this expectation.
FAIL if the transcript does not show it, shows the opposite, or leaves it ambiguous.
Judge only this one expectation; ignore formatting and anything else the run did or did not do.

For context only (not a separate requirement), the intended behaviour overall: Declines to write tests in bulk: works one behaviour at a time (one failing test, least code to pass, refactor), letting each test follow from what the last cycle taught.
