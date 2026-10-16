---
# GENERATED from skills/graph/evals/evals.json (id 6) by scripts/build-evals.mjs. Do not edit.
description: "graph #6 (edge)"
tags: [graph, edge]
plugins: ["../.."]
max_turns: 40
timeout_seconds: 900
allowed_tools: [Read, Glob, Grep, Skill, Agent, TodoWrite]
expected_outcome: "Runs node <root>/tools/graph/graph.mjs serve from the project root in the background (render alone gives a read-only snapshot), opens the exact address it prints locally, and points the user at the Docs tab: the folder tree and search, wikilinks and backlinks, Edit or Split with Ctrl/⌘-S to save, + New note. Says the server listens on 127.0.0.1 only, writes only .md notes in the project's repositories, refuses a save from a stale copy, and runs until it is stopped."
---

I want to browse our project docs and edit them in the browser, like an Obsidian vault.
