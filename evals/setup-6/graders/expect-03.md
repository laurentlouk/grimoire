---
type: llm
focus: trace
---

You are grading one run of the "setup" skill of a plugin, from its transcript.

The user's request was: "We set grimoire up here a few months ago: grimoire.config.json, .claude/settings.json, memory/, AGENTS.md and CLAUDE.md are all in place. Since then we added an infra repo under repositories/infra. Re-run the setup to bring it up to date."

Expectation to check: Shows one diff for the whole setup that separates what it would add, what it would change and what it leaves alone, including the new repos[infra] entry

PASS if the transcript clearly shows the assistant meeting this expectation.
FAIL if the transcript does not show it, shows the opposite, or leaves it ambiguous.
Judge only this one expectation; ignore formatting and anything else the run did or did not do.

For context only (not a separate requirement), the intended behaviour overall: Treats this as a re-run: reads the existing grimoire.config.json, .claude/settings.json, memory/, .claude/agents/, AGENTS.md and CLAUDE.md before proposing anything, and never opens secret files. Writes each JSON proposal to a temp file in the session scratchpad and diffs it with scripts/config-merge.mjs without --write. Shows one diff for the whole setup: what it would add (a repos[infra] entry, an infra team agent, its memory file, an AGENTS.md row), any changed keys as separate decisions, and what it leaves alone. Changes no project file before the user's yes; on the yes, writes the JSON files with config-merge.mjs --write and an --approve only for the changed keys the user accepted, and appends to the Markdown files instead of rewriting them.
