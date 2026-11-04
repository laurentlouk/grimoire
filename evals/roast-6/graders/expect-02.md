---
type: llm
focus: trace
---

You are grading one run of the "roast" skill of a plugin, from its transcript.

The user's request was: "Roast a plan to route small tasks to a cheaper review path and save about 20 % per run. Recorded runs are under .grimoire/runs."

Expectation to check: Puts the measured share next to the claimed saving in the spec, and revises the claim if the share is small

PASS if the transcript clearly shows the assistant meeting this expectation.
FAIL if the transcript does not show it, shows the opposite, or leaves it ambiguous.
Judge only this one expectation; ignore formatting and anything else the run did or did not do.

For context only (not a separate requirement), the intended behaviour overall: Before approving, runs the proposed routing rule over the recorded runs and states in the spec what share of tasks it would send down the cheaper path, next to the claimed saving; treats an unmeasured share as a guess and recalibrates the claim when the share is small.
