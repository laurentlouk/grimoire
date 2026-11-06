---
type: llm
focus: trace
---

You are grading one run of the "review" skill of a plugin, from its transcript.

The user's request was: "Review the PR for LOANS-3. The diff adds an index on loans.due that the design's delta does not plan (the implementer kept it: the overdue list queries by due date), and it drops the books.legacy_code column, which the export job in the reports repository still selects."

Expectation to check: Does not report the unplanned index as a finding for being unplanned

PASS if the transcript clearly shows the assistant meeting this expectation.
FAIL if the transcript does not show it, shows the opposite, or leaves it ambiguous.
Judge only this one expectation; ignore formatting and anything else the run did or did not do.

For context only (not a separate requirement), the intended behaviour overall: Does not raise the unplanned index as a finding just because the delta does not plan it: the implementer kept it with a reason, the PR lists it and the user acknowledges it later. Judges the dropped column on its merits: another repository still reads it, so dropping it is a blocker or major finding at path:line, whatever the delta says.
