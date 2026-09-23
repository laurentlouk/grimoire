---
type: llm
focus: trace
---

You are grading one run of the "orchestrate" skill of a plugin, from its transcript.

The user's request was: "The execute run on EXPORT halted halfway through overnight. Kick it off again."

Expectation to check: Waits for the completion notification rather than polling

PASS if the transcript clearly shows the assistant meeting this expectation.
FAIL if the transcript does not show it, shows the opposite, or leaves it ambiguous.
Judge only this one expectation; ignore formatting and anything else the run did or did not do.

For context only (not a separate requirement), the intended behaviour overall: Resumes rather than re-running: relaunches with resumeFromRunId and the same scriptPath and args so completed agent calls return cached results; then waits for the completion notification instead of polling.
