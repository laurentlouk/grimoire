---
type: llm
focus: trace
---

You are grading one run of the "manager" skill of a plugin, from its transcript.

The user's request was: "What can we hand to AI next from the tracker?"

Expectation to check: No tracker write is attempted

PASS if the transcript clearly shows the assistant meeting this expectation.
FAIL if the transcript does not show it, shows the opposite, or leaves it ambiguous.
Judge only this one expectation; ignore formatting and anything else the run did or did not do.

For context only (not a separate requirement), the intended behaviour overall: Runs the briefing the same way (tracker-scout per tracker source, then scripts/manager.mjs brief with --check-repos) and answers from its Hand to AI group: the issues with acceptance criteria, not started, no assignee (or claim.identity), nothing open blocking them, no linked PR, no sub-issues, and a repos[] entry that is checked out, each with its repo and next step. Explains why a candidate the user names is not there by quoting its reason from the briefing. It offers the ready issues as checkboxes and launches only what the user ticks: nothing is launched, dispatched or looped on its own.
