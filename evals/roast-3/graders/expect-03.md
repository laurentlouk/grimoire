---
type: llm
focus: trace
---

You are grading one run of the "roast" skill of a plugin, from its transcript.

The user's request was: "Roast adding retries to the webhook consumer in the API repo. I don't remember which queue client we use or what the current retry limit is."

Expectation to check: Lists them in the spec's Self-answered questions with their source

PASS if the transcript clearly shows the assistant meeting this expectation.
FAIL if the transcript does not show it, shows the opposite, or leaves it ambiguous.
Judge only this one expectation; ignore formatting and anything else the run did or did not do.

For context only (not a separate requirement), the intended behaviour overall: Answers both facts itself from the code or config (sending a scout if the search is wide), cites the file and location, and does not ask the user for them; records them under Self-answered questions. Only product or trade-off decisions (e.g. how long a customer may wait) reach the user, one per message with a recommendation.
