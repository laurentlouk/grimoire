---
type: llm
focus: trace
---

You are grading one run of the "setup" skill of a plugin, from its transcript.

The user's request was: "Grimoire and its manager block are set up in this project (Linear, team ODY, through the claude.ai connector). Re-run the setup and add a daily schedule for the manager briefing. I work in the Claude desktop app, which has scheduled tasks; weekdays at 08:30 is fine."

Expectation to check: Proposes the headless probe with claude -p and --permission-prompts none behind env -u ANTHROPIC_API_KEY -u ANTHROPIC_AUTH_TOKEN, never --bare and never an API key, and runs it only on the user's yes

PASS if the transcript clearly shows the assistant meeting this expectation.
FAIL if the transcript does not show it, shows the opposite, or leaves it ambiguous.
Judge only this one expectation; ignore formatting and anything else the run did or did not do.

For context only (not a separate requirement), the intended behaviour overall: Treats the schedule as an opt-in item in the re-run's one diff. Finds the desktop app's scheduled-tasks tool with ToolSearch and proposes a desktop task, not a crontab line: a cron expression in local time (30 8 * * 1-5) and a self-contained prompt that runs /grimoire:manager for this project by its absolute path as a scheduled, headless run. Proposes manager.schedule = {kind: desktop-task, when: 30 8 * * 1-5} (with the task's id once created) through config-merge.mjs without --write, says the task takes no budget (budgetUsd stays null), and the permission allow rules a headless run needs (the source's read tools by name, never the whole server) for the user to apply to .claude/settings.json. Proposes the headless probe (env -u ANTHROPIC_API_KEY -u ANTHROPIC_AUTH_TOKEN claude -p with --permission-prompts none, one read per source, never --bare) and runs it only on the user's yes, then asks a second yes before creating the task. Calls create_scheduled_task (or any other tool that creates or changes a task) only after the user's yes to the schedule, and writes nothing before it.
