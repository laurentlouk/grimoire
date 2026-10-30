![Grimoire — Orchestrate agents. Build. Learn.](docs/assets/grimoire-banner.png)

# 🔮 grimoire

*A spellbook for coding agents: portable skills, a roster, a memory, and a build loop that learns.*

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Claude Code plugin](https://img.shields.io/badge/Claude%20Code-plugin-8A2BE2)](#-setup)
[![Agent Skills](https://img.shields.io/badge/Agent%20Skills-15-success)](#-what-is-in-the-box)
[![Stack-agnostic](https://img.shields.io/badge/stack-agnostic-lightgrey)](#)

Open-source [Agent Skills](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview) plus the pieces around them that make an agent workflow repeatable: an agent roster (`AGENTS.md`), curated memory (`memory/`), and an unattended build loop (`workflows/`) that ends every run by crystallizing what it learned back into the skills. Stack-agnostic, tracker-agnostic (Jira, Linear, GitHub Issues, or other).

## 🚀 Setup

### 🧩 With Claude Code, as a plugin (recommended)

```text
/plugin marketplace add laurentlouk/grimoire
/plugin install grimoire@grimoire
```

Then, in the project, run:

```text
/grimoire:setup
```

It explores the repositories and proposes, in one screen, a team agent per repo (with the gate it must never run), the memory stores seeded only with facts found in your docs, the roster (`AGENTS.md`), the loop's `repos` configuration, and the lines to add to `CLAUDE.md`. Nothing is written until you say yes, and nothing existing is overwritten. A session-start hint points at it while the project has no roster.

Prefer to do it by hand? Copy `memory/`, `AGENTS.md`, `templates/team-agent.md` (one per repo into `.claude/agents/`) and optionally `workflows/`, then add `@memory/harness.md` and a pointer to `AGENTS.md` in your `CLAUDE.md`.

### 👥 Pin it for the whole team

Add to the project's `.claude/settings.json` so everyone who trusts the folder gets the plugin, no prompts:

```json
{
  "extraKnownMarketplaces": { "grimoire": { "source": { "source": "github", "repo": "laurentlouk/grimoire" } } },
  "enabledPlugins": { "grimoire@grimoire": true }
}
```

`/grimoire:setup` writes this for you, along with `grimoire.config.json` (repos, gates, rtk guard) that `/orchestrate` reads. **Updating** is one command: `/plugin update grimoire@grimoire` (marketplace plugins also refresh in the background). Nothing is copied into the project except your own agents, memory and config, so an update reaches every project at once.

### 📜 With Claude Code, skills only

```sh
npx skills add laurentlouk/grimoire      # every skill → .claude/skills/
```

### 🧭 Without Claude Code

Skills are plain `SKILL.md` files and work in any agent that reads them (`npx skills add laurentlouk/grimoire` installs them for several). `AGENTS.md` and `memory/` are Markdown any agent can be pointed at; import `memory/harness.md` from whatever instruction file your agent reads. The build loop in `workflows/` is a Claude Code Workflow script and runs only there; without it you walk the pipeline one skill at a time, which is how it is meant to be used interactively anyway.

## ⚡ Use

**🪄 First run**: `/grimoire:setup`. **🔁 The pipeline**, one skill recommending the next:

```
roast → to-plan → to-issues → build ⇄ review → PR → crystallize → ship
```

```text
/roast <idea>        # stress-test the design; answers itself from docs + code first, asks you only real decisions
/to-plan             # synthesize the approved spec into a plan of vertical slices
/to-issues           # one tracker issue per slice, with blocked-by links
/launch-agent …      # dispatch a team agent or scout from AGENTS.md, memory pasted in
/tdd                 # the discipline for writing the code
/crystallize         # after the PR: patch/create skills, add memory facts, sync docs, one reviewable PR
/orchestrate {specPath, planPath, project, repos}   # or run the whole build half unattended
/grimoire:logs       # what the loop decided, and why: a local HTML report of every run
/grimoire:graph      # the code graph as a local HTML page: architecture, system map, file map, neighbourhoods, hotspots, docs
/grimoire:architecture  # an architecture diagram the code backs: drafted from the graph, refined from the code, checked
/grimoire:manager    # the briefing: what is urgent, what to decide, what to hand to AI, ranked from the tracker
```

`/orchestrate` needs a fourth input besides the three design artifacts: `repos`, the list of repositories with their owning agent, tags (for review-lens selection) and gate command. It previews first, with a wall-clock estimate (a strict blocked-by chain runs one task at a time). Once it runs, every landed task is pushed to one draft PR per repo, and a halted or killed run picks up where it stopped when you invoke `/orchestrate` on the same project again. Leave the session alone while it runs: a message sent to it reaches the prompts of the agents the run dispatches, so give instructions after the run, or stop it first. `workflows/README.md` has the full reference.

**🧠 How the harness learns.** `roast` treats the code as the source of truth and fixes documentation that drifted from it. `crystallize` runs after a PR, reads its review threads, and turns what they taught into skill patches, memory facts and doc fixes, in a PR a human reviews and merges. The loop does this automatically at the end of every run, and reads the previous runs' ledgers at the start of the next one. Memory is small, capped and declarative on purpose (`memory/README.md`); procedures belong in skills.

**🔍 Explore before asking; don't guess: built in.** If a fact is discoverable in the docs, the code, schemas, contracts, config or git history, an agent finds it before asking and never states a discoverable fact as a guess; only decisions the owner holds (product/UX calls, cost or vendor trade-offs, priorities, context outside the codebase) come back as questions, and an inconclusive search says what was checked and what is still unknown. Nothing to paste into `CLAUDE.md`: the rule is carried by the skills that ask (`roast`, `to-plan`, `to-issues`, `implement`, `launch-agent`, `setup`), the team-agent template, every scout and the reviewer, and the loop's briefs and dispatch header, so no project can miss it.

## 🕸️ The code graph: research fast, then read the code

The plugin ships a code graph (`tools/graph`): every repository of the project parsed with tree-sitter into a local SQLite graph of definitions and their relations (`CALLS`, `IMPORTS`, `EXTENDS` / `IMPLEMENTS`, tests, git co-change), for TypeScript/JavaScript, Python, Rust, Go, Java, Kotlin, C, C++, C#, Ruby, PHP and Swift. Scouts and the design skills reach it as MCP tools (`graph_search`, `graph_callers`, `graph_impact`, `graph_path`, `graph_hierarchy`, `graph_file`, `graph_sql`, …) to answer *where is it* and *what relates to what* in one call instead of a dozen greps: who calls this, what a change reaches and which tests cover it, how a request gets to a write.

It is a map for research, never the source of truth: every answer is a `path:line` lead with the confidence of its edge, and what the code does or whether it is right is always read in the code. The reviewer does not get it at all. Incremental (only changed files re-parse, queries refresh themselves), no service to run, and its parser runtime installs itself on first index. Indexing is always the deterministic script, never a model: the plugin's `SubagentStop` hook re-runs it after every implementer and integrate step, and each worktree gets its own index, started from the index of the branch it is based on (see [Worktrees](#-worktrees-one-config-one-graph-per-branch)). `/grimoire:graph` renders all of it as one local page: a system map of modules that opens onto the file map, every file and symbol as a neighbourhood (what uses it, what it uses), and hotspots by size and churn, with test code and ambiguous links hidden until asked for and unique-name matches drawn dashed. `/grimoire:setup` proposes it; the reference is [`tools/graph/README.md`](tools/graph/README.md).

**Architecture diagrams, backed by the code.** Grimoire's own, after the example of [archify](https://github.com/tt-a1i/archify) (no dependency on it): a diagram is typed JSON (components with a type, boundaries, labelled connections, cards) drawn as an interactive page and, unlike a free-hand diagram, checked by the code graph. `/grimoire:architecture` drafts one from the graph (modules as components, the services their imports name, file links as lines), has the agent refine it by reading the code, and checks it: every component's paths must match indexed files and its `path:line` sources must exist, each line between code components is counted against the index, and code links no line draws are reported. The page's **Architecture** tab draws every diagram in `docs/architecture/` (plus one drafted fresh on each render), with a passport per component, upstream and downstream reach, and route tracing. Scroll to zoom around the pointer (a trackpad pinch too), drag or use the scrollbars to pan, or use the controls in the diagram's corner: Fit, −, the size, +, and ⛶ for full size (the diagram fills the window; Esc leaves). The system map and the file map have the same controls.

**The docs as a vault.** The page's **Docs** tab holds every Markdown note of the project, the Obsidian way: a folder tree, a reading view with callouts and front matter, `[[wikilinks]]`, backlinks, an outline, and the code each note mentions linked to its neighbourhood (and each file's notes listed on its page). `graph.mjs serve` serves the page on `127.0.0.1` behind a token, and then notes can be edited (source, reading or side by side), saved with Ctrl/⌘-S, and created; a save from a stale copy is refused and the disk version offered.

## 🔭 Seeing what the loop decided: `/grimoire:logs`

Every execute run writes a **decision journal**: which agent and model each task was routed to and why, each precheck and reviewer verdict, the findings the verifier overturned, every fix, escalation, guard decision, replan, claim, gate and halt, with the output tokens at each step. It lives locally in `.grimoire/runs/<runId>/` (gitignored), tagged with the grimoire version and a hash of the briefs, personas and config, so runs can be compared across harness changes. The committed run ledger in `runs/` keeps the summary.

`/grimoire:logs` answers questions straight from the journal ("why did PROJ-12 run on opus?"), renders one self-contained HTML report you open locally, shows what each run really cost (read from Claude Code's transcripts, cache included: output tokens are only a few percent of it), per dispatch, task, model tier, review lens and repo, prints the cross-run summary `crystallize` learns from (first-round pass rate, fix rounds per model tier, findings overturned per lens, guard passes a later sweep re-flagged, cost per tier and lens), and prunes runs older than six months (`telemetry.retentionDays`).

## 🧭 The team's briefing: `/grimoire:manager`

One page of what the team owes, from three sources: tracker issues (Linear, Jira or GitHub), open pull requests, and grimoire's own loop runs.

- **Read-only.** A `tracker-scout` reads each source and cannot write: the guard hook refuses any MCP tool whose name reads as a write (`send`, `create`, `update`, …).
- **Ranked by rules you can read.** `scripts/manager.mjs` sorts everything into **Decide**, **Do**, **Hand to AI**, **Waiting on others** and **Not now**. Urgency comes from the tickets' fields, never from the model.
- **Hands work to AI.** Tick ready issues in the briefing, or in the panel in the desktop app, and it starts one conversation per tracker project, routed to `/orchestrate`, to `implement` then `review`, or to `roast`.
- **Around it:** a local HTML briefing page; a one-line headline at the start of each session, warning when the briefing is stale; an optional daily schedule, as a desktop task or a cron line under your own login (never an API key); and an opt-in shared post (`manager.share`: a Linear document, a GitHub issue or a Slack canvas), replaced each run and kept small enough to retype. That post is its only write.

## 🌳 Worktrees: one config, one graph per branch

Each worktree is its own checkout, but the project's settings are not per branch, and the graph should not start from nothing.

- **The config reads through to the main checkout.** `grimoire.config.json` is often untracked or gitignored, so a new worktree would not have it. Every reader (the guard, the graph, the manager, the log renderer) resolves it with [`scripts/project-config.mjs`](scripts/project-config.mjs): a linked worktree without its own file uses the main checkout's, and one with its own file layers it over the main one (objects merge key by key; a value the worktree sets, an array included, replaces the main one). Nothing is copied, so an edit on main shows up everywhere at once, and a `protectedBranches` set on main still protects a worktree. `node scripts/project-config.mjs --root <dir>` prints what a checkout sees (`--sources` lists the files). The same idea as Claude Code reading its project settings from the main checkout.
- **The graph starts from the right base.** A worktree's first index is a copy of its base's, so it parses only what its branch changed. The base is the first of: `baseBranch` in the config, the branch's upstream (`git worktree add -b feat ../feat origin/dev`), `origin/HEAD`, then `main` or `master`, as long as another checkout has that branch checked out with an index; otherwise the main checkout. A branch stacked on `dev` starts from dev's index, and one on top of `main` from main's.
- **It falls back to the base after a merge.** When a worktree's HEAD moves (a pull, a rebase, a merge of main), its next index compares two numbers: files to re-parse from its own index, and from the base's. When the base's is clearly closer (work merged into main and already indexed there), it copies the base's index and re-parses only the difference. This saves parsing and never changes the answers. `graph_status` names the base.

## 🛡️ Seatbelts for unattended runs

- **Cost fuse**: `maxOutputTokens` caps a run's output tokens, across resumed sessions; the run stops dispatching, lets in-flight work settle and halts as `budget_exhausted`.
- **Guard hook**: a `PreToolUse` hook denies pushes to protected branches, recursive deletes outside the project, and agent edits to the project's Claude settings and hooks (`hooks/README.md`). A seatbelt, not a sandbox.
- **Claims**: with `claim.identity` set, the loop assigns each issue to itself as it starts it, never builds an issue someone else has started, and hands back what it did not land.
- **Cheap checks before expensive ones**: a haiku precheck rejects an empty or stubbed diff before any reviewer is paid, and each blocking finding is verified against the code before it buys a fix.
- **Late is not dead**: an agent cannot be cancelled, so one past its time limit is waited for and its result accepted, never booked dead and retried into the checkout it is still writing. A writer that passes the hard limit fences its repo, and the run halts saying the agent may still commit.
- **Progress on the remote**: each landed task is pushed (fast-forward, hooks run, never forced) to a draft PR per repo that is updated as tasks land and marked ready after the gate. Its description claims only what reached the remote, and once it is out of draft (the gate's doing, or yours) only the gate pushes to it. A halt adds a status comment with the reason, what to fix and how to resume. `deliver: 'end'` keeps a repo's pushes for the end.
- **Environment checks**: a signed commit and the remote are probed for every repo, with any `environmentChecks` of your own, at start (the run refuses) and whenever something stalls (new dispatches pause, the failure is re-checked once, and only a failing re-check halts the run, no replan spent). A locked commit-signing agent costs minutes, not a night. On a Mac running on battery the run warns, because a machine that sleeps makes every agent late.
- **Replans spent on the code only**: the replanner names the cause of what failed. A machine problem halts the run instead of burning the replan budget, and a loop problem (an agent that died or ran late, a merge the loop could not make) is free as many times as the budget allows, then charged.
- **Resume from saved state**: the saved state is the run's `run.json` checkpoint and a state marker in its draft PR, trusted only as far as git confirms it. Invoking `/orchestrate` on a project that already has a run finds it, previews what landed with the SHAs that prove it, and builds only the rest; a run branch it cannot build on (diverged from origin, or behind and not fast-forwardable) refuses the launch rather than redo or overwrite work. `freshStart: true` starts over on purpose. The tracker alone cannot resume a run: its issues close only when the PR merges.

## 💸 Token economy: rtk

Every tool result an agent sees costs tokens, and an unattended loop sees thousands. [rtk](https://github.com/rtk-ai/rtk) rewrites each Bash command to `rtk <cmd>` and condenses its output before it enters context, keeping the signal and dropping the noise. Install it once and register its hook:

```sh
brew install rtk-ai/tap/rtk && rtk init -g     # registers `rtk hook claude` as a PreToolUse(Bash) hook
```

`/grimoire:setup` detects rtk and proposes the project-level hook plus the loop's guard. The guard is `requireHook` in `/orchestrate`: an execute run probes the session it runs in and refuses to dispatch when the hook is missing, because a registered hook whose binary is absent fails silently on every call and the whole run would read raw output.

```json
"requireHook": {
  "name": "rtk hook claude",
  "check": "command -v rtk && rtk hook check \"git status\" | grep -q '^rtk '",
  "fix": "brew install rtk-ai/tap/rtk && rtk init -g, then restart the session",
  "raw": "rtk proxy"
}
```

`raw` is the prefix that runs one command with its output uncompressed. Implementers and the gate are told to re-run a command that way when its condensed output is empty, garbled or contradicts its exit code, before drawing a conclusion (without `raw` they get the same rule, phrased generically).

Without rtk everything still works; it just costs more.

## 📦 What is in the box

Installed as a plugin, skills are called as `/grimoire:roast` (or just `/roast` when unambiguous), and the loop's briefs live under the plugin root: pass `briefsDir: "${CLAUDE_PLUGIN_ROOT}/workflows/briefs"` and `personasDir` alike to `/orchestrate` if you did not copy `workflows/` into the project.


| Path | What |
| --- | --- |
| [`skills/setup`](skills/setup/SKILL.md) | First run: explore the project, propose agents, memory, roster, loop config; write on approval. A re-run shows one diff and writes only what is approved |
| [`skills/roast`](skills/roast/SKILL.md) | Stress-test a design: docs and code recon in parallel, self-answer ladder, open-source references, one question at a time |
| [`skills/to-plan`](skills/to-plan/SKILL.md) · [`skills/to-issues`](skills/to-issues/SKILL.md) | Spec → plan → vertical-slice issues |
| [`skills/tdd`](skills/tdd/SKILL.md) | Red, green, refactor, one behaviour at a time |
| [`skills/launch-agent`](skills/launch-agent/SKILL.md) | Dispatch from the roster with memory injected |
| [`skills/crystallize`](skills/crystallize/SKILL.md) | Post-PR learning into skills, memory and docs |
| [`skills/orchestrate`](skills/orchestrate/SKILL.md) · [`skills/adaptive-replanning`](skills/adaptive-replanning/SKILL.md) | Front door and failure behaviour of the loop |
| [`skills/logs`](skills/logs/SKILL.md) | Read, render and prune the loop's decision journal |
| [`skills/graph`](skills/graph/SKILL.md) | Browse the code graph as a local page: architecture, system map, file map, neighbourhoods, hotspots, and the docs as a vault (editable when served) |
| [`skills/architecture`](skills/architecture/SKILL.md) | An architecture diagram the code backs: drafted from the graph, refined by reading the code, checked against the index |
| [`skills/manager`](skills/manager/SKILL.md) | The briefing: tracker issues ranked and grouped by what the team owes, by read-only scouts and a tested script |
| [`agents/`](agents) | scouts (`codebase-scout`, `reference-scout`, `contract-checker`, `tracker-scout`, `design-scout`, `security-scout`, `perf-scout`), the `reviewer`, and the specialists `migration-engineer` and `test-engineer` the loop can route tasks to |
| [`templates/`](templates) | the team-agent definition to copy per repository |
| [`skills/implement`](skills/implement/SKILL.md) · [`skills/review`](skills/review/SKILL.md) | Build one issue through its team agent; gate it with the diverse-lens panel |
| [`memory/`](memory/README.md) | Harness and per-agent stores, Hermes-style rules |
| [`AGENTS.md`](AGENTS.md) | The roster and the three learning stores |
| [`workflows/`](workflows/README.md) | `orchestrate-loop.js` (engine, tested), `briefs/` and `personas/` (everything a dispatched agent reads) |
| [`hooks/`](hooks/README.md) | the session-start hint and briefing headline, the `PreToolUse` guard, and the graph refresh after each subagent |
| [`tools/graph/`](tools/graph/README.md) | the code graph: indexer, MCP server (`.mcp.json`), CLI, the page and its local server, research-only |
| [`docs/architecture/`](docs/architecture/grimoire.architecture.json) | grimoire's own architecture diagram, checked against its code graph |
| [`.harness/`](.harness/README.md) | the MCP policy and a manifest of the files that decide what agents may do; checked in CI |
| [`scripts/`](scripts) · [`evals/`](evals/README.md) | the log renderer, the setup re-run's config merge, the config every checkout sees (`project-config.mjs`), the manager briefing, the drift check CI runs, and the skill evals (`skills/*/evals/evals.json`, generated into `evals/` for `claude plugin eval`) |

## 🧪 Developing grimoire

```sh
npm test               # every test file, in parallel (the graph's need `npm ci --prefix tools/graph`); --jobs N or GRIMOIRE_TEST_JOBS to cap
npm run test:fast      # the same without the six slow loop-durability files: about 25 s, for iterating
node scripts/run-tests.mjs scripts/manager.test.mjs   # only the files you name
npm run check          # drift: roster ↔ agents, briefs ↔ engine, evals present, config documented
npm run evals:check    # evals/ is up to date with skills/*/evals/evals.json
claude plugin eval .   # run the skill evals (paid; see evals/README.md)
npm run hooks          # once per clone: the pre-push check below
```

The pre-push check runs CI's fast checks (`npm run check`, `npm run evals:check`) on exactly the commit being pushed, in about a second, and blocks the push when one fails: no model, no API key, no sign-in. The full test suite stays in CI. It is opt-in per clone, `git push --no-verify` skips it, and once `core.hooksPath` points at `.githooks`, hooks in `.git/hooks` stop running.

What changed in each release: [CHANGELOG.md](CHANGELOG.md).

Every change that ships bumps the version in `.claude-plugin/plugin.json` and opens its `CHANGELOG.md` entry under that version (no "Unreleased" section): projects install releases only, so a change merged without a bump never reaches them. The drift check enforces it (`scripts/version-check.mjs`): CI compares each pull request with its base branch, and the pre-push hook with `origin/main`. Only changes under `docs/` and `.github/` ship without one.

## 📄 License

[MIT](LICENSE)
