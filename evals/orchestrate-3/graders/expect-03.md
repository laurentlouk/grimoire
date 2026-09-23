---
type: llm
focus: trace
---

You are grading one run of the "orchestrate" skill of a plugin, from its transcript.

The user's request was: "Run the loop on the EXPORT project unattended, execute right away. We haven't written a spec or plan, the tickets are enough."

Expectation to check: Names the missing plan and the skill that produces it (`to-plan`)

PASS if the transcript clearly shows the assistant meeting this expectation.
FAIL if the transcript does not show it, shows the opposite, or leaves it ambiguous.
Judge only this one expectation; ignore formatting and anything else the run did or did not do.

For context only (not a separate requirement), the intended behaviour overall: Refuses to launch: says the spec (produced by roast) and the plan (produced by to-plan) are missing and names the skill that produces each.
