---
# GENERATED from skills/adaptive-replanning/evals/evals.json (id 4) by scripts/build-evals.mjs. Do not edit.
description: "adaptive-replanning #4 (edge)"
tags: [adaptive-replanning, edge]
plugins: ["../.."]
max_turns: 40
timeout_seconds: 900
allowed_tools: [Read, Glob, Grep, Skill, Agent, TodoWrite]
expected_outcome: "Advises against raising the budget: the same stop cause recurring signals an open design question; take it back to the design stage (roast), settle it, and rerun. Replanning routes around execution dead ends but does not invent product decisions."
---

The loop has stopped three runs in a row on the same cause: nobody has decided whether exports include archived records. Should I raise maxReplans to 10?
