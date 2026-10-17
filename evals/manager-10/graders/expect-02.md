---
type: llm
focus: trace
---

You are grading one run of the "manager" skill of a plugin, from its transcript.

The user's request was: "/grimoire:manager launch ODY-99 (Sent from the briefing panel. ODY-99 is not in the latest briefing: it was opened after it.)"

Expectation to check: Reports that ODY-99 is refused because it is not in the latest briefing

PASS if the transcript clearly shows the assistant meeting this expectation.
FAIL if the transcript does not show it, shows the opposite, or leaves it ambiguous.
Judge only this one expectation; ignore formatting and anything else the run did or did not do.

For context only (not a separate requirement), the intended behaviour overall: Runs scripts/manager.mjs launch-check 'ODY-99' with --root and --config. It refuses ODY-99 with the reason 'not in the latest briefing' and plans no group. The skill says so, quoting the reason, starts no conversation and prints no launch prompt, and offers a fresh briefing (/grimoire:manager) so the issue can be checked. It does not fall back to launch-plan or launch the issue another way.
