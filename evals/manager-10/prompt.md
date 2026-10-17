---
# GENERATED from skills/manager/evals/evals.json (id 10) by scripts/build-evals.mjs. Do not edit.
description: "manager #10 (edge)"
tags: [manager, edge]
plugins: ["../.."]
max_turns: 40
timeout_seconds: 900
allowed_tools: [Read, Glob, Grep, Skill, Agent, TodoWrite]
expected_outcome: "Runs scripts/manager.mjs launch-check 'ODY-99' with --root and --config. It refuses ODY-99 with the reason 'not in the latest briefing' and plans no group. The skill says so, quoting the reason, starts no conversation and prints no launch prompt, and offers a fresh briefing (/grimoire:manager) so the issue can be checked. It does not fall back to launch-plan or launch the issue another way."
---

/grimoire:manager launch ODY-99 (Sent from the briefing panel. ODY-99 is not in the latest briefing: it was opened after it.)
