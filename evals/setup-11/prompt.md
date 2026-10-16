---
# GENERATED from skills/setup/evals/evals.json (id 11) by scripts/build-evals.mjs. Do not edit.
description: "setup #11 (negative)"
tags: [setup, negative]
plugins: ["../.."]
max_turns: 40
timeout_seconds: 900
allowed_tools: [Read, Glob, Grep, Skill, Agent, TodoWrite]
expected_outcome: "This asks for the briefing, not for setup: it belongs to the manager skill. Setup must not run its exploration, re-bind the sources or propose any file."
---

Grimoire and its manager block are set up. What's urgent in our Linear today, and what can we hand to AI?
