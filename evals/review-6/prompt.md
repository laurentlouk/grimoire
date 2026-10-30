---
# GENERATED from skills/review/evals/evals.json (id 6) by scripts/build-evals.mjs. Do not edit.
description: "review #6 (edge)"
tags: [review, edge]
plugins: ["../.."]
max_turns: 40
timeout_seconds: 900
allowed_tools: [Read, Glob, Grep, Skill, Agent, TodoWrite]
expected_outcome: "Counts the four earlier fix rounds against the three-round cap across every review source, so it does not start another round on its own: it hands the remaining findings to the user with what each would cost. It does not send the six minors back as a round of their own (they ride with a major-driven round or go to a ticket), re-reviews only the failed lens if the user does approve a fix, and does not start the gate until a review passes on the final head."
---

We're on ODY-945's PR in a session. It already went through the reviewer, a re-review, Codex and a Claude PR review, each followed by a fix round. A privacy re-review now reports one major and six minors. Laurent said to fix things the review found. Next step?
