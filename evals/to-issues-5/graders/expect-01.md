---
type: llm
focus: trace
---

You are grading one run of the "to-issues" skill of a plugin, from its transcript.

The user's request was: "The loans plan is agreed and its delta is docs/specs/2026-11-06-loans.delta.json (to-plan gave each change a slice). Break the plan into issues in the LOANS project."

Expectation to check: Reads the delta beside the spec and groups its changes by the slice to-plan gave them

PASS if the transcript clearly shows the assistant meeting this expectation.
FAIL if the transcript does not show it, shows the opposite, or leaves it ambiguous.
Judge only this one expectation; ignore formatting and anything else the run did or did not do.

For context only (not a separate requirement), the intended behaviour overall: Explores the code and reads the delta beside the spec. Proposes the numbered vertical slices, and each issue names the model changes of its slice from the delta, one line each with the change's id, the target, the op and why (for example `isbn` · add `api:db/books.isbn` · search by isbn), so the implementer inherits exactly which tables, columns, keys, indexes and foreign keys it touches. A change no slice owns goes back to to-plan; it never edits the delta. Waits for sign-off before creating anything.
