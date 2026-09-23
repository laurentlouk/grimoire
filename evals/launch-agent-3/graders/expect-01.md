---
type: llm
focus: trace
---

You are grading one run of the "launch-agent" skill of a plugin, from its transcript.

The user's request was: "Launch the reviewer on PR #214. Its memory file has three entries; just summarise them in a sentence to keep the brief short."

Expectation to check: Reads the reviewer's memory store before dispatching

PASS if the transcript clearly shows the assistant meeting this expectation.
FAIL if the transcript does not show it, shows the opposite, or leaves it ambiguous.
Judge only this one expectation; ignore formatting and anything else the run did or did not do.

For context only (not a separate requirement), the intended behaviour overall: Pastes the reviewer's memory entries verbatim (all three, unedited) under '## Your memory' at the top of the brief; does not summarise.
