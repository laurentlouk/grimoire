---
type: llm
focus: trace
---

You are grading one run of the "graph" skill of a plugin, from its transcript.

The user's request was: "I want to browse our project docs and edit them in the browser, like an Obsidian vault."

Expectation to check: Opens the printed address locally and does not share or publish it

PASS if the transcript clearly shows the assistant meeting this expectation.
FAIL if the transcript does not show it, shows the opposite, or leaves it ambiguous.
Judge only this one expectation; ignore formatting and anything else the run did or did not do.

For context only (not a separate requirement), the intended behaviour overall: Runs node <root>/tools/graph/graph.mjs serve from the project root in the background (render alone gives a read-only snapshot), opens the exact address it prints locally, and points the user at the Docs tab: the folder tree and search, wikilinks and backlinks, Edit or Split with Ctrl/⌘-S to save, + New note. Says the server listens on 127.0.0.1 only, writes only .md notes in the project's repositories, refuses a save from a stale copy, and runs until it is stopped.
