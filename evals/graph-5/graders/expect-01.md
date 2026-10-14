---
type: llm
focus: trace
---

You are grading one run of the "graph" skill of a plugin, from its transcript.

The user's request was: "Open the code graph and show me how the backend's modules depend on each other, and what calls StreamWrapper.send_message."

Expectation to check: Renders and opens the page locally rather than answering from graph tools alone

PASS if the transcript clearly shows the assistant meeting this expectation.
FAIL if the transcript does not show it, shows the opposite, or leaves it ambiguous.
Judge only this one expectation; ignore formatting and anything else the run did or did not do.

For context only (not a separate requirement), the intended behaviour overall: Renders the page with graph.mjs render and opens it locally. Points the user at the Map tab's system map (one lane per repository, modules linked by the file pairs that use each other) and at the symbol's neighbourhood (search it, or the #sym-<id> anchor): callers on the left, callees on the right, test code and ambiguous links hidden until their toggles are on. Reminds that links are matched by name and confirms anything it states in the code at the path:line.
