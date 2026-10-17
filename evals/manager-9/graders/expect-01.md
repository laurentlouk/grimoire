---
type: llm
focus: trace
---

You are grading one run of the "manager" skill of a plugin, from its transcript.

The user's request was: "/grimoire:manager launch ODY-12 ODY-31 (Sent by the Launch button of the briefing panel in the Claude desktop app. The latest briefing is 2 hours old and lists both under Hand to AI, ODY-12 in project Billing and ODY-31 in project Onboarding, on different repos; every repo is checked out; ToolSearch finds a start_session tool.)"

Expectation to check: Runs manager.mjs launch-check with the two ids from the message, before starting anything

PASS if the transcript clearly shows the assistant meeting this expectation.
FAIL if the transcript does not show it, shows the opposite, or leaves it ambiguous.
Judge only this one expectation; ignore formatting and anything else the run did or did not do.

For context only (not a separate requirement), the intended behaviour overall: Does not run a new briefing or dispatch any scout. Runs scripts/manager.mjs launch-check 'ODY-12' 'ODY-31' with --root and --config, which checks both ids against the latest briefing (latest.json) and a fresh repos check and prints the plan: two groups, one per tracker project, neither waiting, nothing refused. It finds the session-starting tool with ToolSearch and starts exactly two new conversations, each with that group's prompt as its first message, verbatim: ids, routes and repo paths only. Then it says what it started.
