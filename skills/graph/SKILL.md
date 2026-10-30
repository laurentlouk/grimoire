---
name: graph
description: Browse the code graph as a local HTML page, or refresh it. Use when the user says "show the graph", "visualize the codebase", "open the code map", "what depends on what", "show me the call graph", "which files are hotspots", "rebuild the graph index", "browse the docs", or "edit the docs like Obsidian". Refreshes the index with the deterministic indexer, renders one self-contained page (overview, architecture diagrams, system map of modules, file map, files and symbols as neighbourhoods, hotspots, the project's Markdown notes as a vault) and opens it locally; serves it on 127.0.0.1 when the notes should be editable. Drawing or updating an architecture diagram is the architecture skill's job.
---

# Graph: the code graph as a page

The code graph (`tools/graph`) is a local index of every repository in the project: definitions and how they relate. Agents query it through the `graph_*` tools; this skill shows all of it to a human in one page.

## Where it lives

- The index: `.grimoire/graph/graph.db` in the checkout (`graph.dir` in `grimoire.config.json` moves it), gitignored. Each checkout has its own, since each branch has its own code; a worktree starts from the index of the branch it is based on (`baseBranch`, its upstream, `origin/HEAD`, `main`) and re-bases onto it after a merge when that saves parsing.
- Indexing is always the script, never a model: `node <plugin root>/tools/graph/graph.mjs index` (incremental; `--full` rebuilds). The plugin's `SubagentStop` hook and every query refresh it on their own.
- The plugin root is the directory two levels above this `SKILL.md`.

## Render the page

```sh
node <plugin root>/tools/graph/graph.mjs render                 # refresh, then → .grimoire/graph/graph.html
node <plugin root>/tools/graph/graph.mjs render --out map.html  # somewhere else
node <plugin root>/tools/graph/graph.mjs serve                  # the same page on 127.0.0.1, notes editable
```

`render` writes a read-only snapshot. When the user wants to **edit the docs**, run `serve` in the background instead: it refreshes the index, prints one address (`http://127.0.0.1:<port>/?t=<token>`; the token is the access key, so open that exact address and do not paste it anywhere else), re-renders the page on every load, and runs until stopped (Ctrl-C, or kill it when the user is done). `--port <n>` fixes the port. Run either from the project root so it finds `grimoire.config.json`. It refreshes the index first, so the page matches the code on disk, and prints the path it wrote. Open it locally: `open <path>` on macOS, `xdg-open <path>` on Linux. When it says there is no index yet, build one with `graph.mjs index` (the first run installs the parser runtime, about 50 MB, once per machine), then render.

The page is one file with no network access:

- **Architecture**: every diagram in `docs/architecture/*.architecture.json` (written by `/grimoire:architecture`), checked against the index on this render (its errors and warnings in *The check*), then one drafted from the graph on every render, marked as a draft. Typed components inside their boundaries, labelled lines; a line the graph confirms is solid, one it cannot see between two code components is dashed amber unless it says what carries it (`via`). Click a component for its passport (the code it covers, its sources, each line with what the graph saw); **Upstream**, **Downstream** and **Route to…** light up what the drawn lines reach; *Code links not drawn* shows what the diagram leaves out. Natural size by default (drag to pan); the controls in the diagram's corner give **Fit** for the whole of it, −, the size, + and **⛶ full size** (the diagram fills the window, the passport beside it; Esc leaves). `#arch-<n>` opens a diagram.
- **Docs**: every Markdown note of the project's repositories (and of the project root, in a hub), as a vault: a folder tree (the header search filters by path and text), a reading view with front matter as properties, callouts and task lists, `[[wikilinks]]` resolved by note name, relative links, and inline code naming an indexed file linked to its neighbourhood; beside it the outline, backlinks with the line that links, the code the note mentions, and unresolved links. A file's page lists the notes that mention it. On a served page: **Read**, **Edit** (source) or **Split**, Ctrl/⌘-E to switch, Ctrl/⌘-S or **Save** to write the file, **+ New note** (an unresolved `[[link]]` offers to create its note). A save from a copy that changed on disk since is refused, with the choice to load the disk version or overwrite; a served page also reloads a note that changed on disk when it gets focus back. `#doc-<n>` opens a note.
- **Overview**: repositories with their HEAD and index time, languages, production and test files, modules, symbol and link counts, and how many call links are name guesses.
- **Map**: opens on the **system map**: one lane per repository drawing its 14 largest modules (folders of production code; a folder holding more than 35% of its repository splits into its subfolders) in the order code flows, a line per module using another, its width the number of file pairs linked by syntax. It never shows test code or name guesses. Hover a module for its links and their counts; click it for its files on the **file map** (one cluster per directory, coloured by repository, laid out once at render time, labels carry their folder; the 1,500 most connected files at most, production code first). Drag, zoom, double-click to reset. The system map and the file map carry the same corner controls (Fit, −, size, +, ⛶ full size).
- **Files** and **Symbols**: search everything; a file or a symbol opens beside the list as a neighbourhood: what uses it on the left, what it uses on the right, links resolved by syntax solid and first, name matches dashed, every hidden count said; the full lists stay one click away, with supertypes and subtypes.
- **Hotspots**: a treemap of the 400 largest files (area is size, colour is churn: how many of the last 400 commits touched the file, commits touching more than 25 indexed files left out), most-called symbols, widest fan-out and most-used files ranked by links resolved by syntax (name guesses counted apart), files that change together in git history.
- **Test code** and **Ambiguous links** are hidden until their toggle is on, in the lists, the neighbourhoods and the file map; unique-name matches show, dashed in the neighbourhoods. Every view has a plain anchor (`#sym-12`, `#file-3`, `#mod-4`, `#hotspots`); `#sym-` and `#file-` numbers are index ids that change when that file is re-parsed, and `#mod-` numbers follow the modules' order, which shifts when modules gain or lose files or links: an anchor holds for the index the page was rendered from.

## Rules

- **A map, not the code.** Every edge is resolved by name, with a confidence. Before stating what code does, read it at the `path:line` the page gives. A missing edge proves nothing (dynamic dispatch, reflection, config wiring, top-level code): confirm "no callers" with grep.
- **Keep it local.** The page holds the project's file paths, symbol names and every Markdown note. Never publish, upload or share it unless the user explicitly asks, and say what it contains before you do. `serve` listens on 127.0.0.1 only and writes nothing but `.md` notes inside the project's repositories; never expose it on another interface or forward its port.
- **Explore before asking; don't guess.** Check `grimoire.config.json` and whether the index exists before asking the user anything. When the graph is disabled (`graph.enabled: false`), say so and stop.
