---
type: llm
focus: trace
---

You are grading one run of the "to-issues" skill of a plugin, from its transcript.

The user's request was: "The plan includes renaming the account id field across both repos; there are hundreds of call sites. Break it into issues."

Expectation to check: Sequences the rename as expand then contract across several issues

PASS if the transcript clearly shows the assistant meeting this expectation.
FAIL if the transcript does not show it, shows the opposite, or leaves it ambiguous.
Judge only this one expectation; ignore formatting and anything else the run did or did not do.

For context only (not a separate requirement), the intended behaviour overall: Sequences the wide mechanical change as expand then contract: add the new form next to the old, move call sites in batches, then delete the old form; never one big rewrite. Proposes it as a numbered breakdown for sign-off.
