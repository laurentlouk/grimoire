---
type: llm
focus: trace
---

You are grading one run of the "launch-agent" skill of a plugin, from its transcript.

The user's request was: "Send the API engineer on EXPORT-3, and tell it to save anything it learns to its memory file as it goes."

Expectation to check: Explains that `crystallize` writes memory after the PR

PASS if the transcript clearly shows the assistant meeting this expectation.
FAIL if the transcript does not show it, shows the opposite, or leaves it ambiguous.
Judge only this one expectation; ignore formatting and anything else the run did or did not do.

For context only (not a separate requirement), the intended behaviour overall: Dispatches the engineer but does not ask it to write memory; explains that crystallize writes memory, after the PR.
