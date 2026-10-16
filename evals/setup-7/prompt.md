---
# GENERATED from skills/setup/evals/evals.json (id 7) by scripts/build-evals.mjs. Do not edit.
description: "setup #7 (edge)"
tags: [setup, edge]
plugins: ["../.."]
max_turns: 40
timeout_seconds: 900
allowed_tools: [Read, Glob, Grep, Skill, Agent, TodoWrite]
expected_outcome: "Keeps the hand-edited repos[api].gate: it is the user's choice, so the proposal either leaves it alone or shows it as one CHANGED key (repos[api].gate, current value against proposed) that needs the user's explicit approval, never a silent overwrite and never a mix of the two gates. Other hand-written keys show as kept. Nothing is written before the yes, and the write uses config-merge.mjs --write with --approve 'repos[api].gate' only if the user accepted that change."
---

Update our grimoire setup. Heads-up: after the first run I edited the api repo's gate in grimoire.config.json by hand, to `make e2e-test E2E_LOCK_WAIT=3600`, because the e2e lock queue is long. The Makefile's e2e target itself has not changed.
