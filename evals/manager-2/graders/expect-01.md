---
type: llm
focus: trace
---

You are grading one run of the "manager" skill of a plugin, from its transcript.

The user's request was: "Give me the briefing: what should we do next? (We haven't added a manager block to grimoire.config.json yet; Linear is in toolHints.tracker.)"

Expectation to check: Falls back to toolHints.tracker as one source instead of stopping or inventing a manager config

PASS if the transcript clearly shows the assistant meeting this expectation.
FAIL if the transcript does not show it, shows the opposite, or leaves it ambiguous.
Judge only this one expectation; ignore formatting and anything else the run did or did not do.

For context only (not a separate requirement), the intended behaviour overall: Finds no manager block in grimoire.config.json and falls back to toolHints.tracker as a single source with the id tracker. Says so plainly in the reply and points at /grimoire:setup to add the manager section. Asks which team or project to read only if no scope can be found in the config, then dispatches tracker-scout once with that source, runs scripts/manager.mjs brief on the WorkItems, and shows the result.
