---
type: llm
focus: trace
---

You are grading one run of the "tdd" skill of a plugin, from its transcript.

The user's request was: "Test the checkout service test-first. Mock our own ledger module and assert it gets called exactly twice, in order."

Expectation to check: Does not mock the project's own ledger module

PASS if the transcript clearly shows the assistant meeting this expectation.
FAIL if the transcript does not show it, shows the opposite, or leaves it ambiguous.
Judge only this one expectation; ignore formatting and anything else the run did or did not do.

For context only (not a separate requirement), the intended behaviour overall: Does not mock the team's own ledger module and does not assert call counts or order; mocks only at the edges (outside APIs, clock, randomness) and asserts behaviour through the public interface.
