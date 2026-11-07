---
# GENERATED from skills/tdd/evals/evals.json (id 5) by scripts/build-evals.mjs. Do not edit.
description: "tdd #5 (edge)"
tags: [tdd, edge]
plugins: ["../.."]
max_turns: 40
timeout_seconds: 900
allowed_tools: [Read, Glob, Grep, Skill, Agent, TodoWrite]
expected_outcome: "Works one behaviour at a time, and takes the expected values from the generator itself: runs it at development time (in a throwaway container if it needs a database) on small schemas and commits what it wrote as golden fixtures the tests read, rather than expectations written from reading the generator's source. Because the files come from any repository, it also builds the hostile shapes (deep nesting, long runs of blanks, many statements, self-referencing expansions) at a size where quadratic work takes seconds and asserts a bound with wide headroom, and plants a fake secret built at runtime in a literal and in a malformed file, asserting it reaches no output and that errors give a position, never the text."
---

Test-first, add a reader to our indexer for the migration SQL and snapshots that our ORM's migration generator writes. The indexer runs over any repository a user points it at.
