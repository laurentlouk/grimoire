---
# GENERATED from skills/setup/evals/evals.json (id 12) by scripts/build-evals.mjs. Do not edit.
description: "setup #12 (edge)"
tags: [setup, edge]
plugins: ["../.."]
max_turns: 40
timeout_seconds: 900
allowed_tools: [Read, Glob, Grep, Skill, Agent, TodoWrite]
expected_outcome: "Treats the schedule as an opt-in item in the re-run's one diff. Finds the desktop app's scheduled-tasks tool with ToolSearch and proposes a desktop task, not a crontab line: a cron expression in local time (30 8 * * 1-5) and a self-contained prompt that runs /grimoire:manager for this project by its absolute path as a scheduled, headless run. Proposes manager.schedule = {kind: desktop-task, when: 30 8 * * 1-5} (with the task's id once created) through config-merge.mjs without --write, says the task takes no budget (budgetUsd stays null), and the permission allow rules a headless run needs (the source's read tools by name, never the whole server) for the user to apply to .claude/settings.json. Probes through the app, never with claude -p and never asking for a CLI login: on the user's yes to the probe, creates the task with no cron expression (manual only) and the probe as its prompt (one read per source), runs it once with run_scheduled_task and reads its result with list_task_runs. Asks a second yes before giving the task its schedule (update_scheduled_task with the cron expression and the /grimoire:manager prompt). Creates no task before the yes to the probe, gives none a schedule before the second yes, and writes no file before them."
---

Grimoire and its manager block are set up in this project (Linear, team ODY, through the claude.ai connector). Re-run the setup and add a daily schedule for the manager briefing. I work in the Claude desktop app, which has scheduled tasks; weekdays at 08:30 is fine.
