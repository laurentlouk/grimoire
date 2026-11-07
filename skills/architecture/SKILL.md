---
name: architecture
description: Draw the project's architecture as a checked, interactive diagram backed by the code, in grimoire's own format and page (archify was the inspiration; it is never installed or called). Drafts it from the code graph, refines it by reading the code (names by responsibility, datastores and queues from config, trust boundaries, what each line carries, path:line sources), checks every component and line against the index, and shows it in the graph page's Architecture tab with upstream, downstream and route tracing. Use when the user says "draw the architecture", "architecture diagram", "how is this system put together", "map the services", "show how the parts talk to each other", "update the architecture diagram", or asks for an archify-style system map; also when a branch changes the architecture (graph_changes lists an architectural impact: update the diagram in the same pull request) or a design's delta proposes architecture changes (read their states). Not for one call chain or who calls what (the graph tools answer that), and not for a numeric chart.
---

# Architecture: a diagram the code backs

A diagram is one typed JSON file, `docs/architecture/<name>.architecture.json` (`graph.architectureDir` in `grimoire.config.json` moves the folder). The graph page (`/grimoire:graph`) draws every file there in its **Architecture** tab, checked against the code graph on each render, next to a draft it makes from the graph itself.

Two hands write it, and the split is the point:

- **The script drafts**, deterministically: one component per module of the system map, typed by folder names and the frameworks it imports; the external services its imports name (PostgreSQL, Redis, Kafka, AWS, Stripe, an LLM API…); a line where files of one module use files of another through links resolved by syntax. Every name and type in a draft is a guess.
- **You refine**, reading the code: what the parts are *for*, what the index cannot see (a datastore reached through config, a queue, an HTTP call to another repository, the users), the boundaries, what flows on each line, and the evidence.
- **The script checks** the result: every `paths` glob matches indexed files, every source exists with its lines, each line between two code components is counted against the index, and code links no line draws are reported. The check keeps the meaning honest; it never decides it.

The plugin root is the directory two levels above this `SKILL.md`; commands below run from the project root (where `grimoire.config.json` is).

## 1 · Explore before asking

- Read `grimoire.config.json`: `graph.enabled` (when `false`, say so and stop), `repos`, `graph.architectureDir`.
- Is there an index? `node <root>/tools/graph/graph.mjs status`. If not, build it: `graph.mjs index` (the first run installs the parser runtime, ~50 MB, once per machine).
- List `docs/architecture/`. **Updating** an existing diagram: start from it, never from a fresh draft, and run `graph.mjs architecture check` first: its warnings are the drift (modules no component covers, lines the code no longer shows, links no line draws).
- Scope comes from the request: the whole system by default; a slice ("the checkout path", "how auth works") keeps only the components on it and says what is left out. Ask the user only what the code and config cannot tell you (a deployment region that lives in a console, who the users are when nothing names them).

## 2 · Draft

```sh
node <root>/tools/graph/graph.mjs architecture draft --out docs/architecture/<slug>.architecture.json --title "<System> architecture"
```

It prints the path and the draft's own check. It never overwrites an existing file (`--force` does, and only when the user asked for a fresh start).

## 3 · Refine, reading the code

Use the graph to find *where* (`graph_search`, `graph_file`, `graph_impact`, or a `codebase-scout`), then read the code at that `path:line` before writing anything down. Entry points, config (env, compose, Terraform, Helm), and the call sites that do I/O are where architecture lives.

**Components** (`components[]`): one per unit the reader needs: a deployable service or app, a worker, a CLI, a datastore, a queue or bus, an external API, the users. Merge modules that ship as one unit; split one that holds two responsibilities. A component is not a folder.

| Field | |
| --- | --- |
| `id` | lower case, digits, `.` `_` `-`; stable (pages and anchors use it) |
| `label` | its responsibility: "Order API", not "src/api" |
| `sublabel` | technology and entry: "FastAPI · :8000", "Postgres 16" |
| `type` | `frontend` `backend` `worker` `database` `messagebus` `cloud` `security` `external` `library` `cli` |
| `paths` | globs of its code: a folder (`src/api`, everything under it), `src/*` (files right in it), `**` across folders; `repo:` prefix in a multi-repo project. Each must match indexed production files |
| `imports` | package prefixes for a component reached through a client library (`pg`, `@aws-sdk/client-s3`, `redis`): the check counts the files importing them |
| `sources` | 1–3 `repo:path:start-end` (or `path:line`) proving it: the entry point, the config block, the write site |
| `note` · `tag` · `repo` | one sentence; a short chip ("JWT", "async"); its repository |
| `col` · `row` | grid cell, both or neither; leave them out first (see Layout) |

**Connections** (`connections[]`): `from` → `to` is who calls whom (the request's direction); for events, producer → bus → consumer. `label` says what flows ("HTTPS / JSON", "SQL", "order.created"). `variant`: `emphasis` for the main path, `security` for an auth check, `async` for queued or event flows, `dashed` for optional or batch. `via` says what carries a line the code graph cannot see ("HTTP to the payments repo", "SQS", "env DATABASE_URL"): set it whenever the line crosses a process or repository.

**Boundaries** (`boundaries[]`): `label`, `kind` (`deploy`, `trust`, `region`, `network`, `repo`, `group`), `wraps: [ids]`. Draw the ones that change how the system behaves: what deploys together, where trust changes, which cloud account or region. Nest one inside another only when every component of the inner one is in the outer.

**Cards** (`cards[]`: `title`, `color` cyan · emerald · violet · amber · rose · orange · slate, `items`): what a line cannot say: invariants, failure modes, what is deliberately left out and why. Few and short.

**Top level**: `schema: 1`, `title`, `summary` (two or three sentences: what the system does and its main path). Remove `"draft": true` once every component has been refined; replace the draft's cards.

**Layout**: leave `col`/`row` out and let the page lay it out by flow (a column per step from what nothing points to, boundaries as bands). Give every component a `col` and `row` only when the check reports a boundary overlap or the reading order is wrong.

Never invent: a component or line you could not tie to code or config is left out, or kept with its uncertainty said in its `note` ("writes here; durability unknown"). An HTTP call is a line with a `via`; a configured but unused client is not.

## 4 · Check until it passes

```sh
node <root>/tools/graph/graph.mjs architecture check docs/architecture/<slug>.architecture.json
```

Errors (exit 1) are fixed: a schema mistake, a glob that matches nothing, a source that does not exist or lines out of range. Each warning is a question to answer, not to silence:

- *no link in the graph* → is the line real? Read the call site; set `via` if it crosses a process, or remove the line.
- *the code links the other way* → flip it, unless it shows data flowing back (then say so in `via`).
- *X uses Y, but no line is drawn* → draw it, or merge the two components if it is one unit.
- *in several components* → narrow the `paths` so each file has one owner.
- *not covered* (the info line) → fine when it is deliberately out of scope; say so in a card.
- *layout* → give the components `col`/`row`.

## 5 · Show it

```sh
node <root>/tools/graph/graph.mjs render          # → .grimoire/graph/graph.html, then open it at #architecture
node <root>/tools/graph/graph.mjs serve           # or: the same page on 127.0.0.1 (prints its address)
```

Open the page locally (`open` on macOS, `xdg-open` on Linux) and point the user at the Architecture tab: click a component for its passport (the code it covers, its sources, each line with what the graph saw), **Upstream** / **Downstream** to trace what it reaches along the drawn lines, **Route to…** for the path between two components, and *Code links not drawn* to see what the diagram leaves out.

Reply with the file's path, one or two sentences of what the architecture is, anything deliberately left out, and the check's result (errors none; warnings left and why).

## 6 · When a branch or a design changes the architecture

The diagram changes with the code, in the same pull request. Two things tell you it has to:

- **A branch's architectural impact.** `graph_changes` (`node <root>/tools/graph/graph.mjs changes`) ends with an *Architecture* part: the diagram files against the base (components, connections, boundaries added, removed or modified), then the check's findings on this branch's index and not on the base checkout's: a new link no line draws, a module no component covers, a new external service by import, a drawn line the code no longer shows. With no index of the base checkout (no other checkout of the repository has one), only the diagram files are compared, and it says so. The page shows the same: the Architecture tab, **Changes vs `<base>`**.
- **A design's delta.** A delta beside the spec (`docs/specs/<date>-<topic>.delta.json`) may propose architecture changes in its `architecture` list, targets `component:<id>`, `connection:<from>-><to>` (`#<label>` after them for one of several lines joining the same two components), `boundary:<label>`, each `after` in the diagram's words (a component `{ label, type, paths? }`, a connection `{ label?, via? }`, a boundary `{ kind?, wraps }`). `graph_changes --delta <file>` gives each its state against the saved diagrams: **planned and built** (drawn as planned), **pending** (not drawn yet), **built differently** (drawn in another shape: planned → built), its acknowledgement **stale** once the change was edited after it; then the branch's impact no change covers, **unplanned**. The Architecture tab's **Delta** draws them over the diagram.

What you do:

- **Unplanned impact: update the diagram in the same pull request, and report it.** A link no line draws: draw the line (or say why it runs through something else, in `via`), reading the code that makes it. A module no component covers: give it a component, or widen the `paths` of the one that owns it. A new external service: add it with `imports`. A drawn line the code no longer shows: remove it, or say what carries it. Then `architecture check` until it passes, as in section 4. Never block on it, and never leave it silent: tell the user in one message what the branch changed in the architecture and what you did with each, and, when the work has a delta, append each kept change to it as `{ id, op, target, after, why, slice, origin: "unplanned" }` (`node <root>/tools/graph/delta-append.mjs <delta> <changes.json>`, which routes an architecture target to `architecture`) for them to acknowledge in the Architecture tab under `graph.mjs serve`. A change you would not keep is reverted in the code instead.
- **Planned changes: build them as the delta states them**, in the diagram, and read their states back: each should end planned and built. Built differently is a finding to settle (update the diagram, or tell the user the design and the code disagree); pending means not drawn yet. Never edit the delta's changes or their acknowledgements: the user acknowledges each in the page.

## Rules

- **The code is the source of truth.** Every component and line is backed by code or config you read; the graph confirms links by name only, so read before you assert.
- **Reachability is not impact.** Upstream, downstream and route follow the lines you drew, not the runtime.
- **Keep it local.** The diagram and the page hold file paths and structure: commit the JSON with the docs, but never publish or upload the page unless the user explicitly asks.
- **Grimoire's own.** The format, the page and the checks are grimoire's, shaped by what its code graph can check and free to evolve with it. archify was the example, not a dependency: never install, call or convert to it.
- **Refine, don't regenerate.** Once refined, a diagram is edited in place; a new draft is for comparison (`--out` elsewhere), never pasted over it.
