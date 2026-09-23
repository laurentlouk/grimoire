---
type: llm
focus: trace
---

You are grading one run of the "review" skill of a plugin, from its transcript.

The user's request was: "Review PR #214 for EXPORT-2 before it merges."

Expectation to check: On PASS, requires every review thread to have an explicit resolution and names `crystallize` as next

PASS if the transcript clearly shows the assistant meeting this expectation.
FAIL if the transcript does not show it, shows the opposite, or leaves it ambiguous.
Judge only this one expectation; ignore formatting and anything else the run did or did not do.

For context only (not a separate requirement), the intended behaviour overall: Uses an independent reviewer, never the implementer: a spec gate (spec hawk) then a quality panel of lenses in parallel, each applied only to repos it fits. Blocker/major findings route back to the implementer and are re-reviewed, bounded; a FAIL names at least one finding with path:line; always ends on a review. On PASS the PR is ready once every thread has an explicit resolution; next is crystallize.
