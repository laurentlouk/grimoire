---
type: llm
focus: trace
---

You are grading one run of the "tdd" skill of a plugin, from its transcript.

The user's request was: "Fix the bug where a user can claim the same reward twice in one session. Do it test-first."

Expectation to check: The test goes through the public interface a real caller uses, not a private helper

PASS if the transcript clearly shows the assistant meeting this expectation.
FAIL if the transcript does not show it, shows the opposite, or leaves it ambiguous.
Judge only this one expectation; ignore formatting and anything else the run did or did not do.

For context only (not a separate requirement), the intended behaviour overall: Writes one failing test for that behaviour through the public interface, watches it fail, writes the least code to pass, then refactors only on green. The assertion compares the whole value against an independent expected value.
