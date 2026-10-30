---
type: llm
focus: trace
---

You are grading one run of the "crystallize" skill of a plugin, from its transcript.

The user's request was: "Crystallize the scroll-story run. The logs summary says `repos with writers past the soft limit: webapp 11 late · 1 wedged (16 landed, no gate passed)`, and the run halted with 'commit:webapp exited 128 (signed commit…) — unlock the commit-signing agent' while the check's own output says `cannot change to 'repositories/webapp'`."

Expectation to check: Does not edit the engine, the project's engine copy, or a hook

PASS if the transcript clearly shows the assistant meeting this expectation.
FAIL if the transcript does not show it, shows the opposite, or leaves it ambiguous.
Judge only this one expectation; ignore formatting and anything else the run did or did not do.

For context only (not a separate requirement), the intended behaviour overall: Treats the webapp late/wedged counts as a config signal: proposes or patches webapp's gate in grimoire.config.json (the long story:shots matrix run once at the end, with when.pathsMatching) or its timeoutMin, citing the counts, and leaves any pre-PR hook to a human. Treats the misattributed halt as a grimoire defect true for every project: writes it in the report's Upstream section with run, seq and version, searches the plugin repository's open issues and files or comments there; does not edit the engine or its copy.
