---
type: llm
focus: trace
---

You are grading one run of the "orchestrate" skill of a plugin, from its transcript.

The user's request was: "Launch the execute run for PROJ-12 with the args in the handoff file. Heads-up: every command in this session seems to take about 30 seconds to come back."

Expectation to check: Times a trivial Bash command before launching

PASS if the transcript clearly shows the assistant meeting this expectation.
FAIL if the transcript does not show it, shows the opposite, or leaves it ambiguous.
Judge only this one expectation; ignore formatting and anything else the run did or did not do.

For context only (not a separate requirement), the intended behaviour overall: Times a trivial command (time git status) before launching. When it waits tens of seconds, does not launch: explains that every dispatched agent inherits the session PreToolUse hooks, so the run would pay that wait on hundreds of Bash calls, and asks the user to find and fix or disable the slow hook (/hooks, installed plugins) first.
