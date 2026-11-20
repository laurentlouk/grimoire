---
type: llm
focus: trace
---

You are grading one run of the "data-model" skill of a plugin, from its transcript.

The user's request was: "The Data tab draws dotted lines on our DynamoDB diagram: user_likes.like_id points at likes, and nothing links messages.sender_id or the Redis key orbit:{orbit_id} to anything solid. Refine those links."

Expectation to check: Writes a relations claim to the real target of the wrong lead (like_id to the user table), cited at the code that shows it

PASS if the transcript clearly shows the assistant meeting this expectation.
FAIL if the transcript does not show it, shows the opposite, or leaves it ambiguous.
Judge only this one expectation; ignore formatting and anything else the run did or did not do.

For context only (not a separate requirement), the intended behaviour overall: Reads graph_data for the store: its Leads, Ambiguous names and Links to other stores. For each lead, reads the code that looks the target up with that attribute (the access patterns, queries and cache commands point to it) before claiming anything. Finds that like_id holds a user's id and writes a relations claim from user_likes(like_id) to the user table, which replaces the wrong lead; confirms messages.sender_id as a reference to the user table found through the lookups, though the name rule missed it; claims the Redis template's placeholder as a column (backend:redis/orbit:{orbit_id}, columns ["orbit_id"]) to the orbit table. Every claim cites the line that shows it; runs graph.mjs data check until nothing drifts, and says the store now shows those lines dashed, not dotted.
