---
type: llm
focus: trace
---

You are grading one run of the "adaptive-replanning" skill of a plugin, from its transcript.

The user's request was: "We set maxReplans to 0. Slice 2 failed its review after the fix rounds, and the whole run stopped. Why, and what happened to slices 3 to 5?"

Expectation to check: Does not claim the loop would retry or replan slice 2

PASS if the transcript clearly shows the assistant meeting this expectation.
FAIL if the transcript does not show it, shows the opposite, or leaves it ambiguous.
Judge only this one expectation; ignore formatting and anything else the run did or did not do.

For context only (not a separate requirement), the intended behaviour overall: Explains that a replan budget of zero turns replanning off, so the first failed slice stops the run; the untried tasks are marked skipped so nothing is silently dropped, and the run report lists them.
