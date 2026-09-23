---
type: llm
focus: trace
---

You are grading one run of the "launch-agent" skill of a plugin, from its transcript.

The user's request was: "Start the API engineer on EXPORT-2."

Expectation to check: Pastes the agent's memory entries verbatim under a `## Your memory` heading at the top of the brief

PASS if the transcript clearly shows the assistant meeting this expectation.
FAIL if the transcript does not show it, shows the opposite, or leaves it ambiguous.
Judge only this one expectation; ignore formatting and anything else the run did or did not do.

For context only (not a separate requirement), the intended behaviour overall: Reads AGENTS.md for the agent's model, tools and brief; reads memory/agents/<agent>.md and pastes its entries verbatim under '## Your memory' at the top; pastes the full task text, spec excerpt, files, success criteria and ticket; includes the explore-before-asking rule, the no-interactive-channel/NEEDS_CONTEXT reminder, incremental commits and the four end states; notes any orchestrator-owned gate.
