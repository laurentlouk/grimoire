---
type: llm
focus: trace
---

You are grading one run of the "orchestrate" skill of a plugin, from its transcript.

The user's request was: "New session. Re-run the orchestrator on the EXPORT spec and plan, same as before; it halted yesterday partway through."

Expectation to check: Looks for the earlier run in the local `run.json` files or the draft PR's state marker before launching

PASS if the transcript clearly shows the assistant meeting this expectation.
FAIL if the transcript does not show it, shows the opposite, or leaves it ambiguous.
Judge only this one expectation; ignore formatting and anything else the run did or did not do.

For context only (not a separate requirement), the intended behaviour overall: Before launching, finds the existing run: the matching <telemetry.dir>/*/run.json (the most recently updated) or, failing that, the state marker in the draft PR on the run branch. Runs the preview with that runId and resumeState and shows its proof (the '◎ resume:' line: k/n landed, verified on the run branch at its head SHA, the draft PR) and what is still to build, then relaunches without resumeFromRunId, with the same runId and resumeState set to that checkpoint. Does not start a fresh run.
