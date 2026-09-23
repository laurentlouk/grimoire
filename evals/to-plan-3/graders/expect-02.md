---
type: llm
focus: trace
---

You are grading one run of the "to-plan" skill of a plugin, from its transcript.

The user's request was: "Plan docs/specs/2026-09-10-export-design.md. It never says whether exports run synchronously or in the background; just pick one. Also, where does our existing file-storage helper live?"

Expectation to check: Does not silently pick synchronous or background execution

PASS if the transcript clearly shows the assistant meeting this expectation.
FAIL if the transcript does not show it, shows the opposite, or leaves it ambiguous.
Judge only this one expectation; ignore formatting and anything else the run did or did not do.

For context only (not a separate requirement), the intended behaviour overall: Reads the helper's location from the code instead of asking or assuming. Treats the sync-vs-background choice as a design gap the spec did not settle: takes it back to `roast` rather than guessing, and does not silently pick one.
