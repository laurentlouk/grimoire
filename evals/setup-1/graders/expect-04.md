---
type: llm
focus: trace
---

You are grading one run of the "setup" skill of a plugin, from its transcript.

The user's request was: "I just installed grimoire. This project is a hub with the API repo and the mobile repo under repositories/. Set up the harness for us."

Expectation to check: Seeds memory only with facts actually found in the docs, dated and declarative, never with guesses

PASS if the transcript clearly shows the assistant meeting this expectation.
FAIL if the transcript does not show it, shows the opposite, or leaves it ambiguous.
Judge only this one expectation; ignore formatting and anything else the run did or did not do.

For context only (not a separate requirement), the intended behaviour overall: Explores read-only in one fan-out (layout, each repo's language, test/lint/typecheck commands and CI jobs, existing instructions, expensive gates with their exact commands, tracker and design tools, rtk, deploy facts); shows a single one-screen proposal (a team agent per repo from templates/team-agent.md, grimoire.config.json with repos and gates, team pinning, memory stores, AGENTS.md roster, CLAUDE.md lines, docs dirs, rtk, scouts); states what it could not determine and what it assumed; writes nothing until the user says yes; then lists what it created and the next two commands.
