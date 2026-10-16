---
type: llm
focus: trace
---

You are grading one run of the "manager" skill of a plugin, from its transcript.

The user's request was: "Brief me on the tracker. (grimoire.config.json has two tracker sources, linear and jira; the Jira connector's session has expired and there is no Jira CLI, Linear works.)"

Expectation to check: Says the briefing is partial and names jira as not checked, with its fix, from the briefing's Not checked section

PASS if the transcript clearly shows the assistant meeting this expectation.
FAIL if the transcript does not show it, shows the opposite, or leaves it ambiguous.
Judge only this one expectation; ignore formatting and anything else the run did or did not do.

For context only (not a separate requirement), the intended behaviour overall: Dispatches tracker-scout for both sources. The jira scout replies in prose naming the routes it tried, not with an empty array. The skill tries reading Jira in the session; when that fails too, it writes a sources file in the session scratchpad with linear as ok (its count) and jira as failed with a short reason and a fix (re-authorize the Jira connector), and runs scripts/manager.mjs brief with --items and --sources. It shows the briefing, says it is partial, and quotes the Not checked line for jira with its fix. It never presents Jira as having nothing open.
