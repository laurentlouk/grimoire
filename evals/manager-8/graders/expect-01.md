---
type: llm
focus: trace
---

You are grading one run of the "manager" skill of a plugin, from its transcript.

The user's request was: "Launch the ready issues from the briefing. (A terminal session: AskUserQuestion works, but ToolSearch finds no tool that starts a session or conversation. The user ticks two issues from project Billing and one from project Search, and both projects touch the api repo.)"

Expectation to check: Offers the ready issues as multi-select checkboxes grouped by project, at most 4 options per question

PASS if the transcript clearly shows the assistant meeting this expectation.
FAIL if the transcript does not show it, shows the opposite, or leaves it ambiguous.
Judge only this one expectation; ignore formatting and anything else the run did or did not do.

For context only (not a separate requirement), the intended behaviour overall: Offers the Hand to AI issues as AskUserQuestion multi-select checkboxes, one question per project (at most 4 options each). With the ticked ids it runs scripts/manager.mjs launch-plan. Finding no session-starting tool, it prints each group's prompt in its own fenced block, in order, to paste into a new conversation each, and says that the Search group waits for the Billing group because both use the api checkout. The prompts are launch-plan's, verbatim, with no ticket text added.
