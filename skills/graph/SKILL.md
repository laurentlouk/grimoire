---
name: graph
description: Browse the code graph as a local HTML page, or refresh it. Use when the user says "show the graph", "visualize the codebase", "open the code map", "what depends on what", "show me the call graph", "which files are hotspots", or "rebuild the graph index". Refreshes the index with the deterministic indexer, renders one self-contained page (overview, dependency map, files, symbols with callers and callees, hotspots) and opens it locally.
---

# Graph: the code graph as a page

The code graph (`tools/graph`) is a local index of every repository in the project: definitions and how they relate. Agents query it through the `graph_*` tools; this skill shows all of it to a human in one page.

## Where it lives

- The index: `.grimoire/graph/graph.db` in the checkout (`graph.dir` in `grimoire.config.json` moves it), gitignored. Each checkout has its own, since each branch has its own code; a linked git worktree starts from the main checkout's.
- Indexing is always the script, never a model: `node <plugin root>/tools/graph/graph.mjs index` (incremental; `--full` rebuilds). The plugin's `SubagentStop` hook and every query refresh it on their own.
- The plugin root is the directory two levels above this `SKILL.md`.

## Render the page

```sh
node <plugin root>/tools/graph/graph.mjs render                 # refresh, then → .grimoire/graph/graph.html
node <plugin root>/tools/graph/graph.mjs render --out map.html  # somewhere else
```

Run it from the project root so it finds `grimoire.config.json`. It refreshes the index first, so the page matches the code on disk, and prints the path it wrote. Open it locally: `open <path>` on macOS, `xdg-open <path>` on Linux. When it says there is no index yet, build one with `graph.mjs index` (the first run installs the parser runtime, about 50 MB, once per machine), then render.

The page is one file with no network access:

- **Overview**: repositories with their HEAD and index time, languages, file, symbol and edge counts.
- **Map**: files as a dependency map (imports and calls between files), one named cluster per directory, colored by repository. The layout is computed once at render time and is the same every time. The most connected files carry their name, more appear as you zoom in, and hovering a file names it and highlights what it uses and what uses it. The 1,500 most connected files when there are more. Drag, zoom, click a file to open it, double-click to reset the view.
- **Files** and **Symbols**: search everything; a file shows what it depends on, what uses it and what it defines; a symbol shows where it is, its callers and callees with how each edge was resolved, and its supertypes and subtypes.
- **Hotspots**: most-called symbols, widest fan-out, most depended-on files, files that change together in git history.

## Rules

- **A map, not the code.** Every edge is resolved by name, with a confidence. Before stating what code does, read it at the `path:line` the page gives. A missing edge proves nothing (dynamic dispatch, reflection, config wiring, top-level code): confirm "no callers" with grep.
- **Keep it local.** The page holds the project's file paths and symbol names. Never publish, upload or share it unless the user explicitly asks, and say what it contains before you do.
- **Explore before asking; don't guess.** Check `grimoire.config.json` and whether the index exists before asking the user anything. When the graph is disabled (`graph.enabled: false`), say so and stop.
