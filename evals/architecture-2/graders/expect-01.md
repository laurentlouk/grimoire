---
type: llm
focus: trace
---

You are grading one run of the "architecture" skill of a plugin, from its transcript.

The user's request was: "We added a billing worker last week and the architecture diagram in docs/architecture is out of date. Update it."

Expectation to check: Edits the existing diagram file in place instead of re-drafting over it

PASS if the transcript clearly shows the assistant meeting this expectation.
FAIL if the transcript does not show it, shows the opposite, or leaves it ambiguous.
Judge only this one expectation; ignore formatting and anything else the run did or did not do.

For context only (not a separate requirement), the intended behaviour overall: Starts from the existing diagram, never a fresh draft over it. Runs graph.mjs architecture check on it first and reads its warnings as the drift (a module no component covers, links no line draws). Reads the billing worker's code and config, adds it as a worker component with paths, sources and its connections (what it consumes, what it writes), keeps the existing refined names and layout, and checks again until there is no error.
