---
type: llm
focus: trace
---

You are grading one run of the "logs" skill of a plugin, from its transcript.

The user's request was: "How are the loop runs doing lately? What's our success rate, and why do runs halt?"

Expectation to check: Mentions runs with an incomplete journal or a stale running status instead of silently counting them

PASS if the transcript clearly shows the assistant meeting this expectation.
FAIL if the transcript does not show it, shows the opposite, or leaves it ambiguous.
Judge only this one expectation; ignore formatting and anything else the run did or did not do.

For context only (not a separate requirement), the intended behaviour overall: Runs node <root>/scripts/render-logs.mjs summary (or summary --json) from the project root and answers from its outcomes block: runs by outcome (drained, halted, running, stale), run success as drained over finished runs and task landing as landed over settled tasks, each quoted with its counts, and the halts grouped by kind with the latest reason, noting the pre-0.9.0 ones are unclassified. Flags runs whose journal is incomplete (events missing, unfinished writes) as undercounted, and does not draw a trend from a handful of runs. Offers to render the page, whose scorecard shows the same numbers, without publishing it.
