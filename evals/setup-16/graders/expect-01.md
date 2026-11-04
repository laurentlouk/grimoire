---
type: llm
focus: trace
---

You are grading one run of the "setup" skill of a plugin, from its transcript.

The user's request was: "Set up grimoire here. We already have .claude/agents/api-engineer.md, written by hand, with no disallowedTools line."

Expectation to check: Keeps the existing definition and proposes adding the disallowedTools line from the template

PASS if the transcript clearly shows the assistant meeting this expectation.
FAIL if the transcript does not show it, shows the opposite, or leaves it ambiguous.
Judge only this one expectation; ignore formatting and anything else the run did or did not do.

For context only (not a separate requirement), the intended behaviour overall: Keeps the existing api-engineer definition and proposes adding the template's disallowedTools line, one mcp__ccd_<server>__* entry per desktop-app server, explaining that those servers act on the launching session, written only on the user's yes.
