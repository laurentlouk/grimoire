---
type: llm
focus: trace
---

You are grading one run of the "crystallize" skill of a plugin, from its transcript.

The user's request was: "The mobile implementer just reported DONE on issue 640. Capture the learnings now, before the PR."

Expectation to check: Declines to crystallize before the PR exists and explains that review threads are the input

PASS if the transcript clearly shows the assistant meeting this expectation.
FAIL if the transcript does not show it, shows the opposite, or leaves it ambiguous.
Judge only this one expectation; ignore formatting and anything else the run did or did not do.

For context only (not a separate requirement), the intended behaviour overall: Crystallize runs after the PR exists and its threads are settled (or after merge), because the review threads are its main input. Proceed to review and PR first; crystallize afterwards.
