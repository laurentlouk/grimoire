---
type: llm
focus: trace
---

You are grading one run of the "setup" skill of a plugin, from its transcript.

The user's request was: "Add a daily manager briefing to our grimoire setup. We only use Claude Code in the terminal, no desktop app, so there are no scheduled tasks here: cron is fine, weekdays at 08:30. Keep each run under 2 dollars."

Expectation to check: Proposes the headless probe (claude -p with --permission-prompts none, one read per source) and runs it only on the user's yes, flagging a source that fails headless with its fix

PASS if the transcript clearly shows the assistant meeting this expectation.
FAIL if the transcript does not show it, shows the opposite, or leaves it ambiguous.
Judge only this one expectation; ignore formatting and anything else the run did or did not do.

For context only (not a separate requirement), the intended behaviour overall: Finds no scheduled-tasks tool, so it proposes a crontab line for the user to add themselves, and never edits the crontab: 30 8 * * 1-5 cd <absolute project path> && <absolute path of claude> -p "/grimoire:manager" --permission-prompts none --max-budget-usd 2 >> .grimoire/manager/cron.log 2>&1, with a PATH line so cron finds node and gh. The line never has --bare and no API key is set anywhere: the run uses the user's own Claude login. Records manager.schedule = {kind: cron, when: 30 8 * * 1-5} and manager.budgetUsd 2 through config-merge.mjs, proposes the permission allow rules a headless run needs for the user to apply, and proposes the headless probe (claude -p with --permission-prompts none, one read per source), run only on the user's yes; a source that fails headless is flagged with its fix. Nothing is written before the yes.
