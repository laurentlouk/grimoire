---
# GENERATED from skills/setup/evals/evals.json (id 14) by scripts/build-evals.mjs. Do not edit.
description: "setup #14 (edge)"
tags: [setup, edge]
plugins: ["../.."]
max_turns: 40
timeout_seconds: 900
allowed_tools: [Read, Glob, Grep, Skill, Agent, TodoWrite]
expected_outcome: "While exploring the backend, checks where its auth, payment and contract code lives against the default policies.strictPaths, and proposes repos[].strictPaths for what the defaults miss (src/services/auth.rs, **/aws_cognito/**, src/billing_engine/**) in the config diff, written only on the user's yes."
---

Set up grimoire for our project. The Rust backend keeps its auth in src/services/auth.rs and lib/aws_cognito/, and payments in src/billing_engine/.
