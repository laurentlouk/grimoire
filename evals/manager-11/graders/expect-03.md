---
type: llm
focus: trace
---

You are grading one run of the "manager" skill of a plugin, from its transcript.

The user's request was: "Give me the briefing and let me pick what to hand to AI. (A terminal session: ToolSearch finds no widget tool that renders HTML and no tool that starts a session; AskUserQuestion works. The briefing has three issues under Hand to AI in one project.)"

Expectation to check: Offers the ready issues as AskUserQuestion multi-select checkboxes

PASS if the transcript clearly shows the assistant meeting this expectation.
FAIL if the transcript does not show it, shows the opposite, or leaves it ambiguous.
Judge only this one expectation; ignore formatting and anything else the run did or did not do.

For context only (not a separate requirement), the intended behaviour overall: Runs the briefing as usual (tracker-scout per source, then scripts/manager.mjs brief). Finding no widget tool, it shows no panel: it does not run render --widget nor hand-write any HTML. It gives the page's absolute path, .grimoire/manager/briefing.html, with how to open it, and offers the Hand to AI issues as AskUserQuestion multi-select checkboxes. With the ticked ids it runs launch-plan and, with no session tool, prints each group's prompt in a fenced block to paste.
