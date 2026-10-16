---
type: llm
focus: trace
---

You are grading one run of the "architecture" skill of a plugin, from its transcript.

The user's request was: "Show me how the checkout path flows through our repos, with the trust boundaries."

Expectation to check: Checks the diagram with graph.mjs architecture check before showing it

PASS if the transcript clearly shows the assistant meeting this expectation.
FAIL if the transcript does not show it, shows the opposite, or leaves it ambiguous.
Judge only this one expectation; ignore formatting and anything else the run did or did not do.

For context only (not a separate requirement), the intended behaviour overall: Treats it as a slice: drafts (or starts from the existing diagram), keeps only the components on the checkout path, adds trust boundaries (kind trust) found in the auth code or config, marks the main path with the emphasis variant and cross-repository calls with via, says in a card what was left out, checks it, then renders and shows the Route tracing between the entry and the store.
