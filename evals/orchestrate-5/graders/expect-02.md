---
type: llm
focus: trace
---

You are grading one run of the "orchestrate" skill of a plugin, from its transcript.

The user's request was: "The execute run on EXPORT halted halfway through overnight. Kick it off again."

Expectation to check: Mentions `resumeFromRunId` only as an option for a byte-identical relaunch (same scriptPath and exactly the same args), if at all

PASS if the transcript clearly shows the assistant meeting this expectation.
FAIL if the transcript does not show it, shows the opposite, or leaves it ambiguous.
Judge only this one expectation; ignore formatting and anything else the run did or did not do.

For context only (not a separate requirement), the intended behaviour overall: Resumes by state rather than re-running: reads the run's <telemetry.dir>/<runId>/run.json fresh, right before launching, and relaunches without resumeFromRunId, with the same runId and resumeState set to its checkpoint (the engine reads the draft PR's state marker itself and verifies every landed SHA), so landed tasks are absorbed and the budgets kept; uses resumeFromRunId only for a byte-identical relaunch in the same session; reads the halt reason (the draft PR's status comment) before relaunching; then waits for the completion notification instead of polling.
