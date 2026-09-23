---
type: llm
focus: trace
---

You are grading one run of the "crystallize" skill of a plugin, from its transcript.

The user's request was: "PR #212 on the API repo is merged. A review bot flagged an ordering race we fixed in 3f2a1c, and the implementer had to stop twice to ask about the dedup marker. Crystallize it."

Expectation to check: Patches an existing skill rather than creating a narrow new one, and adds an eval case for it

PASS if the transcript clearly shows the assistant meeting this expectation.
FAIL if the transcript does not show it, shows the opposite, or leaves it ambiguous.
Judge only this one expectation; ignore formatting and anything else the run did or did not do.

For context only (not a separate requirement), the intended behaviour overall: Reads the PR diff and every review thread with its resolution; patches the closest umbrella skill with the ordering gotcha and adds an eval case; adds a dated declarative fact to the API role's memory store if it applies to every future task; records both questions as roast misses; writes docs/crystallize/<date>-api-pr212.md and opens a crystallize PR; summarises created/patched items in one screen.
