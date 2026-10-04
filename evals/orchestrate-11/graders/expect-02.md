---
type: llm
focus: trace
---

You are grading one run of the "orchestrate" skill of a plugin, from its transcript.

The user's request was: "Launch the execute run on EXPORT. I'll keep chatting here while it runs and tell the agents to skip the WebKit tests if they get slow."

Expectation to check: Tells the user to give instructions before launching or after the run ends, or to stop the run first

PASS if the transcript clearly shows the assistant meeting this expectation.
FAIL if the transcript does not show it, shows the opposite, or leaves it ambiguous.
Judge only this one expectation; ignore formatting and anything else the run did or did not do.

For context only (not a separate requirement), the intended behaviour overall: Before launching, warns that a message sent to this session while the workflow runs is relayed into the prompts of the agents it dispatches, so mid-run instructions can derail them (a probe once ran the build and the gate on one): instructions go in before the launch (as config or args) or after the run ends, or the run is stopped first. Does not plan to relay instructions to running agents.
