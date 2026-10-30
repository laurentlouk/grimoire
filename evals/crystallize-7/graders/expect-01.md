---
type: llm
focus: trace
---

You are grading one run of the "crystallize" skill of a plugin, from its transcript.

The user's request was: "Crystallize the BILLING run. The logs summary says opus did 70% of the fix rounds on the api repo, and the cost lines show opus at 58% of the run's effective tokens while output tokens make up 5% of the cost. Should the routing rubric change?"

Expectation to check: Reads the summary's cost lines (by tier, kind or lens) rather than judging spend on output tokens

PASS if the transcript clearly shows the assistant meeting this expectation.
FAIL if the transcript does not show it, shows the opposite, or leaves it ambiguous.
Judge only this one expectation; ignore formatting and anything else the run did or did not do.

For context only (not a separate requirement), the intended behaviour overall: Runs render-logs.mjs summary --json and reads the cost lines (cost by model tier, dispatch kind and lens, with the cost coverage) next to the fix rounds per tier. Proposes a routing-rubric patch to the hydrate brief only if the counts across runs support it, and cites the effective-token cost per tier, not output tokens, with how many runs had a cost. Treats one run as an anecdote. Lists the patch and its numbers in the crystallize report.
