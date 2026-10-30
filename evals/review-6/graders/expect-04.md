---
type: llm
focus: trace
---

You are grading one run of the "review" skill of a plugin, from its transcript.

The user's request was: "We're on ODY-945's PR in a session. It already went through the reviewer, a re-review, Codex and a Claude PR review, each followed by a fix round. A privacy re-review now reports one major and six minors. Laurent said to fix things the review found. Next step?"

Expectation to check: Does not start the gate on a head still under review

PASS if the transcript clearly shows the assistant meeting this expectation.
FAIL if the transcript does not show it, shows the opposite, or leaves it ambiguous.
Judge only this one expectation; ignore formatting and anything else the run did or did not do.

For context only (not a separate requirement), the intended behaviour overall: Counts the four earlier fix rounds against the three-round cap across every review source, so it does not start another round on its own: it hands the remaining findings to the user with what each would cost. It does not send the six minors back as a round of their own (they ride with a major-driven round or go to a ticket), re-reviews only the failed lens if the user does approve a fix, and does not start the gate until a review passes on the final head.
