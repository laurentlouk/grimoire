---
# GENERATED from skills/manager/evals/evals.json (id 11) by scripts/build-evals.mjs. Do not edit.
description: "manager #11 (edge)"
tags: [manager, edge]
plugins: ["../.."]
max_turns: 40
timeout_seconds: 900
allowed_tools: [Read, Glob, Grep, Skill, Agent, TodoWrite]
expected_outcome: "Runs the briefing as usual (tracker-scout per source, then scripts/manager.mjs brief). Finding no widget tool, it shows no panel: it does not run render --widget nor hand-write any HTML. It gives the page's absolute path, .grimoire/manager/briefing.html, with how to open it, and offers the Hand to AI issues as AskUserQuestion multi-select checkboxes. With the ticked ids it runs launch-plan and, with no session tool, prints each group's prompt in a fenced block to paste."
---

Give me the briefing and let me pick what to hand to AI. (A terminal session: ToolSearch finds no widget tool that renders HTML and no tool that starts a session; AskUserQuestion works. The briefing has three issues under Hand to AI in one project.)
