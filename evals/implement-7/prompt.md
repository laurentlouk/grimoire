---
# GENERATED from skills/implement/evals/evals.json (id 7) by scripts/build-evals.mjs. Do not edit.
description: "implement #7 (edge)"
tags: [implement, edge]
plugins: ["../.."]
max_turns: 40
timeout_seconds: 900
allowed_tools: [Read, Glob, Grep, Skill, Agent, TodoWrite]
expected_outcome: "Resolves the profile from workflows/policies.md before building: no declared files, so it lists the files the change will touch and classifies those (the repo's strictPaths included); the auth service and the deploy workflow are floors, so the profile is strict and the build runs on opus. After the build it classifies what actually changed (a floor file, or an auth check added, removed or changed) and never lowers the profile. The PR description names the profile and the signal that set it."
---

Implement ODY-792: per-user rate limits on SMS OTP and chat send, backend half. The issue declares no files and there is no policy in grimoire.config.json.
