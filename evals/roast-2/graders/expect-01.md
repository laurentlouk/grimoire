---
type: llm
focus: trace
---

You are grading one run of the "roast" skill of a plugin, from its transcript.

The user's request was: "The spec at docs/specs/2026-09-01-export-design.md is approved. Write the implementation plan now."

Expectation to check: Does not start a new round of design questions

PASS if the transcript clearly shows the assistant meeting this expectation.
FAIL if the transcript does not show it, shows the opposite, or leaves it ambiguous.
Judge only this one expectation; ignore formatting and anything else the run did or did not do.

For context only (not a separate requirement), the intended behaviour overall: Design is settled; this is `to-plan`'s job (synthesis, no interview). Roast should not re-interrogate an approved spec.
