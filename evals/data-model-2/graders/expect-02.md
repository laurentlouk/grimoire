---
type: llm
focus: trace
---

You are grading one run of the "data-model" skill of a plugin, from its transcript.

The user's request was: "graph_data says my data map has drift: 'indexes[0] (line 25) index ... ByOwner: backend/src/events.ts line 3 names none of: ByOwner'. Fix it."

Expectation to check: Reads the code to find where the index is queried now before moving the citation

PASS if the transcript clearly shows the assistant meeting this expectation.
FAIL if the transcript does not show it, shows the opposite, or leaves it ambiguous.
Judge only this one expectation; ignore formatting and anything else the run did or did not do.

For context only (not a separate requirement), the intended behaviour overall: Treats the drift as the refine file disagreeing with the code, never as a reason to silence the check. Runs graph.mjs data check to list every drift, opens the cited file to find where the index is now queried (or learns it is no longer used), then edits the existing refine file in place: moves the citation to the line that names the index, or removes the claim if the code no longer supports it. Never cites an unrelated line just to pass. Runs data check again until it passes and tells the user what drifted and what was changed.
