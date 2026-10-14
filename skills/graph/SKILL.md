---
name: graph
description: Browse the code graph as a local HTML page, or refresh it. Use when the user says "show the graph", "visualize the codebase", "open the code map", "what depends on what", "show me the call graph", "which files are hotspots", or "rebuild the graph index". Refreshes the index with the deterministic indexer, renders one self-contained page (overview, system map of modules, file map, files and symbols as neighbourhoods, hotspots) and opens it locally.
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

- **Overview**: repositories with their HEAD and index time, languages, production and test files, modules, symbol and link counts, and how many call links are name guesses.
- **Map**: opens on the **system map**: one lane per repository drawing its 14 largest modules (folders of production code; a folder holding more than a third of its repository splits into its subfolders) in the order code flows, a line per module using another, its width the number of file pairs linked by syntax. It never shows test code or name guesses. Hover a module for its links and their counts; click it for its files on the **file map** (one cluster per directory, coloured by repository, laid out once at render time, labels carry their folder; the 1,500 most connected files at most, production code first). Drag, zoom, double-click to reset.
- **Files** and **Symbols**: search everything; a file or a symbol opens beside the list as a neighbourhood: what uses it on the left, what it uses on the right, links resolved by syntax solid and first, name matches dashed, every hidden count said; the full lists stay one click away, with supertypes and subtypes.
- **Hotspots**: a treemap of the 400 largest files (area is size, colour is churn: how many of the last 400 commits touched the file, sweeps of more than 25 files left out), most-called symbols, widest fan-out and most-used files ranked by links resolved by syntax (name guesses counted apart), files that change together in git history.
- **Test code** and **Ambiguous links** are hidden until their toggle is on, in the lists, the neighbourhoods and the file map; unique-name matches always show, dashed. Every view has a plain anchor (`#sym-12`, `#file-3`, `#mod-4`, `#hotspots`); the numbers are index ids, so a link holds until the next full rebuild.

## Rules

- **A map, not the code.** Every edge is resolved by name, with a confidence. Before stating what code does, read it at the `path:line` the page gives. A missing edge proves nothing (dynamic dispatch, reflection, config wiring, top-level code): confirm "no callers" with grep.
- **Keep it local.** The page holds the project's file paths and symbol names. Never publish, upload or share it unless the user explicitly asks, and say what it contains before you do.
- **Explore before asking; don't guess.** Check `grimoire.config.json` and whether the index exists before asking the user anything. When the graph is disabled (`graph.enabled: false`), say so and stop.
