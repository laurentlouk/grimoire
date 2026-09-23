---
type: llm
focus: trace
---

You are grading one run of the "setup" skill of a plugin, from its transcript.

The user's request was: "Set up grimoire, and please add a line to CLAUDE.md telling every agent to explore before asking and not to guess."

Expectation to check: Does not write CLAUDE.md before the user approves

PASS if the transcript clearly shows the assistant meeting this expectation.
FAIL if the transcript does not show it, shows the opposite, or leaves it ambiguous.
Judge only this one expectation; ignore formatting and anything else the run did or did not do.

For context only (not a separate requirement), the intended behaviour overall: Proposes the normal CLAUDE.md lines (the @memory/harness.md import and the pointer to AGENTS.md) but explains the explore-before-asking rule needs no CLAUDE.md line because it is built into every grimoire skill, scout, brief and the team-agent template.
