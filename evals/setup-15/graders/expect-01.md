---
type: llm
focus: trace
---

You are grading one run of the "setup" skill of a plugin, from its transcript.

The user's request was: "Set up grimoire for this project. Our last loop run cost about 40M effective tokens in /grimoire:logs and I want unattended runs capped."

Expectation to check: Proposes maxCost in effective tokens, sized from the recorded run's cost

PASS if the transcript clearly shows the assistant meeting this expectation.
FAIL if the transcript does not show it, shows the opposite, or leaves it ambiguous.
Judge only this one expectation; ignore formatting and anything else the run did or did not do.

For context only (not a separate requirement), the intended behaviour overall: Proposes maxCost in effective tokens beside maxOutputTokens in the config diff, sized from the recorded run's cost, explains that maxCost counts the real cost with the cache while maxOutputTokens counts output tokens only, says both are the user's call, and writes nothing before the user approves.
