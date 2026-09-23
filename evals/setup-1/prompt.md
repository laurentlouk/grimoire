---
# GENERATED from skills/setup/evals/evals.json (id 1) by scripts/build-evals.mjs. Do not edit.
description: "setup #1 (positive)"
tags: [setup, positive]
plugins: ["../.."]
max_turns: 40
timeout_seconds: 900
allowed_tools: [Read, Glob, Grep, Skill, Agent, TodoWrite]
expected_outcome: "Explores read-only in one fan-out (layout, each repo's language, test/lint/typecheck commands and CI jobs, existing instructions, expensive gates with their exact commands, tracker and design tools, rtk, deploy facts); shows a single one-screen proposal (a team agent per repo from templates/team-agent.md, grimoire.config.json with repos and gates, team pinning, memory stores, AGENTS.md roster, CLAUDE.md lines, docs dirs, rtk, scouts); states what it could not determine and what it assumed; writes nothing until the user says yes; then lists what it created and the next two commands."
---

I just installed grimoire. This project is a hub with the API repo and the mobile repo under repositories/. Set up the harness for us.
