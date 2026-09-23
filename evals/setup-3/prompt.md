---
# GENERATED from skills/setup/evals/evals.json (id 3) by scripts/build-evals.mjs. Do not edit.
description: "setup #3 (edge)"
tags: [setup, edge]
plugins: ["../.."]
max_turns: 40
timeout_seconds: 900
allowed_tools: [Read, Glob, Grep, Skill, Agent, TodoWrite]
expected_outcome: "Treats this as migration mode: lists .claude/skills/roast/ as a duplicate the plugin now provides and proposes deleting it, without deleting on its own; keeps the existing backend-engineer definition and, if it lacks the 'Explore before asking; don't guess' section, proposes appending it; points at the existing invariants rather than duplicating them; never overwrites CLAUDE.md or AGENTS.md, it appends or shows the diff for the user to apply."
---

Set up grimoire here. We already have a CLAUDE.md with our invariants, an AGENTS.md listing a backend-engineer, and an old copy of the roast skill in .claude/skills/roast/.
