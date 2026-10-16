---
# GENERATED from skills/setup/evals/evals.json (id 6) by scripts/build-evals.mjs. Do not edit.
description: "setup #6 (edge)"
tags: [setup, edge]
plugins: ["../.."]
max_turns: 40
timeout_seconds: 900
allowed_tools: [Read, Glob, Grep, Skill, Agent, TodoWrite]
expected_outcome: "Treats this as a re-run: reads the existing grimoire.config.json, .claude/settings.json, memory/, .claude/agents/, AGENTS.md and CLAUDE.md before proposing anything, and never opens secret files. Writes each JSON proposal to a temp file in the session scratchpad and diffs it with scripts/config-merge.mjs without --write. Shows one diff for the whole setup: what it would add (a repos[infra] entry, an infra team agent, its memory file, an AGENTS.md row), any changed keys as separate decisions, and what it leaves alone. Changes no project file before the user's yes; on the yes, writes the JSON files with config-merge.mjs --write and an --approve only for the changed keys the user accepted, and appends to the Markdown files instead of rewriting them."
---

We set grimoire up here a few months ago: grimoire.config.json, .claude/settings.json, memory/, AGENTS.md and CLAUDE.md are all in place. Since then we added an infra repo under repositories/infra. Re-run the setup to bring it up to date.
