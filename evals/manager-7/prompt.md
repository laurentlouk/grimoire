---
# GENERATED from skills/manager/evals/evals.json (id 7) by scripts/build-evals.mjs. Do not edit.
description: "manager #7 (edge)"
tags: [manager, edge]
plugins: ["../.."]
max_turns: 40
timeout_seconds: 900
allowed_tools: [Read, Glob, Grep, Skill, Agent, TodoWrite]
expected_outcome: "Runs scripts/manager.mjs repos and reports mobile as 'submodule not initialised' with the fix git submodule update --init <its path>, and webapp as 'not checked out' with the fix git clone <remote> repositories/webapp. It offers each fix command and runs one only after the user says yes, from the project root; it never runs a fix on its own nor edits repos[]. Without a yes, launch-plan refuses both ids with the repo reason and its fix, and nothing is launched for them."
---

Launch ODY-40 and ODY-41 from the briefing. (ODY-40 maps to the mobile repo, a submodule that has not been initialised; ODY-41 maps to webapp, whose nested clone under repositories/ is missing and has a remote in repos[].)
