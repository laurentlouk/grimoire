---
type: llm
focus: trace
---

You are grading one run of the "adaptive-replanning" skill of a plugin, from its transcript.

The user's request was: "The loop has stopped three runs in a row on the same cause: nobody has decided whether exports include archived records. Should I raise maxReplans to 10?"

Expectation to check: Does not recommend raising the replan budget as the fix

PASS if the transcript clearly shows the assistant meeting this expectation.
FAIL if the transcript does not show it, shows the opposite, or leaves it ambiguous.
Judge only this one expectation; ignore formatting and anything else the run did or did not do.

For context only (not a separate requirement), the intended behaviour overall: Advises against raising the budget: the same stop cause recurring signals an open design question; take it back to the design stage (roast), settle it, and rerun. Replanning routes around execution dead ends but does not invent product decisions.
