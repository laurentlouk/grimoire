---
# GENERATED from skills/setup/evals/evals.json (id 9) by scripts/build-evals.mjs. Do not edit.
description: "setup #9 (edge)"
tags: [setup, edge]
plugins: ["../.."]
max_turns: 40
timeout_seconds: 900
allowed_tools: [Read, Glob, Grep, Skill, Agent, TodoWrite]
expected_outcome: "Proposes a GitHub tracker source (kind github, scope repos [\"acme/site\"], read through gh, readOnly permission-rule), the prs and runs sources, and the gh permission rules for .claude/settings.json (deny for what the pipeline never runs, ask for what to-issues and claims do), which the user applies with the printed command. Proposes priorityLabels with the defaults: priority: urgent/high/medium/low, P0 to P3 and critical. None of the repo's labels is a priority label, so every issue would read as unknown priority: it offers to create priority: urgent, priority: high, priority: medium and priority: low with gh label create, listed in the one diff as a tracker write and its own decision, and runs those commands only when the user's yes takes that item. No repoLabels for a single repo. Before the yes it makes read calls only (the probe, gh label list) and writes nothing."
---

Set up the grimoire manager briefing for this repo. We track our work in GitHub Issues on acme/site, through the gh CLI, which is logged in. The repo only has GitHub's default labels (bug, enhancement, question and so on).
