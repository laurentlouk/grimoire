---
type: llm
focus: trace
---

You are grading one run of the "setup" skill of a plugin, from its transcript.

The user's request was: "Set up grimoire here. We already have a CLAUDE.md with our invariants, an AGENTS.md listing a backend-engineer, and an old copy of the roast skill in .claude/skills/roast/."

Expectation to check: Does not overwrite the existing CLAUDE.md or AGENTS.md; appends or shows a diff for the user to apply

PASS if the transcript clearly shows the assistant meeting this expectation.
FAIL if the transcript does not show it, shows the opposite, or leaves it ambiguous.
Judge only this one expectation; ignore formatting and anything else the run did or did not do.

For context only (not a separate requirement), the intended behaviour overall: Treats this as migration mode: lists .claude/skills/roast/ as a duplicate the plugin now provides and proposes deleting it, without deleting on its own; keeps the existing backend-engineer definition and, if it lacks the 'Explore before asking; don't guess' section, proposes appending it; points at the existing invariants rather than duplicating them; never overwrites CLAUDE.md or AGENTS.md, it appends or shows the diff for the user to apply.
