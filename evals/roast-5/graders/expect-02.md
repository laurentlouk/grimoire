---
type: llm
focus: trace
---

You are grading one run of the "roast" skill of a plugin, from its transcript.

The user's request was: "Roast idempotent webhook delivery. We have no precedent for it in this codebase; should we just switch to the message broker the big projects use?"

Expectation to check: Does not propose changing the stack or the message broker; states the stack is a fixed input

PASS if the transcript clearly shows the assistant meeting this expectation.
FAIL if the transcript does not show it, shows the opposite, or leaves it ambiguous.
Judge only this one expectation; ignore formatting and anything else the run did or did not do.

For context only (not a separate requirement), the intended behaviour overall: Looks outward at credible open-source projects using the same technologies (widely adopted, active in the last year, known license), reads the actual code path, maps the pattern onto this codebase and writes down what is not adopted. Treats the stack and architecture as fixed inputs: it borrows the pattern, never the stack, so it does not recommend switching broker.
