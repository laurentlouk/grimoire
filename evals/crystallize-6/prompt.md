---
# GENERATED from skills/crystallize/evals/evals.json (id 6) by scripts/build-evals.mjs. Do not edit.
description: "crystallize #6 (edge)"
tags: [crystallize, edge]
plugins: ["../.."]
max_turns: 40
timeout_seconds: 900
allowed_tools: [Read, Glob, Grep, Skill, Agent, TodoWrite]
expected_outcome: "Treats the webapp late/wedged counts as a config signal: proposes or patches webapp's gate in grimoire.config.json (the long story:shots matrix run once at the end, with when.pathsMatching) or its timeoutMin, citing the counts, and leaves any pre-PR hook to a human. Treats the misattributed halt as a grimoire defect true for every project: writes it in the report's Upstream section with run, seq and version, searches the plugin repository's open issues and files or comments there; does not edit the engine or its copy."
---

Crystallize the scroll-story run. The logs summary says `repos with writers past the soft limit: webapp 11 late · 1 wedged (16 landed, no gate passed)`, and the run halted with 'commit:webapp exited 128 (signed commit…) — unlock the commit-signing agent' while the check's own output says `cannot change to 'repositories/webapp'`.
