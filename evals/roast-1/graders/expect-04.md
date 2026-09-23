---
type: llm
focus: trace
---

You are grading one run of the "roast" skill of a plugin, from its transcript.

The user's request was: "Before anyone writes code, roast this idea: add rate limiting to the login endpoint in the API repo."

Expectation to check: The spec contains numbered decisions with the rejected alternative, vertical slices smallest first, and the sections Sources consulted, Self-answered questions and Docs drift fixed

PASS if the transcript clearly shows the assistant meeting this expectation.
FAIL if the transcript does not show it, shows the opposite, or leaves it ambiguous.
Judge only this one expectation; ignore formatting and anything else the run did or did not do.

For context only (not a separate requirement), the intended behaviour overall: Runs the docs lane and the code lane together, diffs them, then interrogates the design one question per message with a recommendation each, pushing on edge cases (concurrency, partial failure, idempotency, load at target scale). Touches no code. On approval writes a short spec under docs/specs/ with problem, goals/non-goals, numbered decisions with rejected alternatives, vertical slices, edge cases, user-owned questions, plus Sources consulted, Self-answered questions and Docs drift fixed. Then passes the spec to to-plan.
