---
type: llm
focus: trace
---

You are grading one run of the "review" skill of a plugin, from its transcript.

The user's request was: "Review the PR for ODY-794 (the app's force-update gate). It resolved to balanced; this is a session, not the loop. The repo's AGENTS.md says not to add hydrate* helpers to stores."

Expectation to check: The spec gate checks the repo's AGENTS.md and CLAUDE.md golden rules and gates a breach as a major

PASS if the transcript clearly shows the assistant meeting this expectation.
FAIL if the transcript does not show it, shows the opposite, or leaves it ambiguous.
Judge only this one expectation; ignore formatting and anything else the run did or did not do.

For context only (not a separate requirement), the intended behaviour overall: Runs the spec gate with the spec hawk reading the repo's AGENTS.md and CLAUDE.md golden rules, so a new hydrate* layer in a store is a major citing the rule and the line. As a session has no terminal sweep, the balanced quality gate adds the terminal lenses that fit the repo's tags (reliability, privacy, human interface, accessibility, store review on a mobile repo) to the per-task core. Lenses are promoted only by policies.promote and a cross-repo dependency, never by wording.
