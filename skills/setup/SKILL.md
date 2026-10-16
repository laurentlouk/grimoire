---
name: setup
description: First-run setup of the grimoire harness in an existing project, and its re-run as an update. Use right after installing the plugin, or when the user says "set up grimoire", "create the agents for this project", "bootstrap the harness", "re-run setup", "update the grimoire setup". Explores the repositories, proposes a team agent per repo, the memory stores, the roster (AGENTS.md), the loop's repos configuration with its gates, and the CLAUDE.md lines, then writes them on the user's approval. On a project already set up, it shows one diff of what it would add, change or keep, and writes only what the user approves.
---

# Set up the harness in this project

Everything the harness needs is derivable from the project except the decisions that are the owner's. Explore first, propose once, write on a yes.

## 0 · Migration mode and re-runs

**Migration.** If the project already carries copies of what the plugin ships — skills named like grimoire's (`roast`, `to-plan`, `to-issues`, `implement`, `review`, `crystallize`, `orchestrate`, `launch-agent`, `tdd`, `adaptive-replanning`, `setup`, `logs`), agents named like grimoire's scouts, specialists and reviewer, a `.claude/workflows/` with `orchestrate-loop.js`, or a memory README — list them as **duplicates the plugin now provides** and propose deleting them, so a plugin update reaches the project without a second copy drifting. Keep anything project-specific: team-agent definitions, memory data files, stack skills, hooks, docs. Never delete without the user's yes.

**Re-run.** When the project already has a `grimoire.config.json`, `.claude/settings.json`, `memory/`, `.claude/agents/`, `AGENTS.md` or `CLAUDE.md`, the run updates what is there. Read them first (the two JSON files only through the script), before exploring. What they hold is the user's choice, including what they edited by hand: re-derive a value only when the code shows it is stale, and say so.

- **Secrets are referenced, never read.** Do not open `.env*`, credential or key files. Never read `.claude/settings.json`, `.claude/settings.local.json` or `~/.claude/settings.json` raw: they can hold tokens in `env`, in permission rules and in hook commands. Name the variable or the file that holds a secret, never its value. The script's output masks them: every `env` value, every value under a key named like a token, key, password, credential or auth, and bearer tokens, URL credentials and known token formats inside any string. To see a JSON file before you propose anything, diff it against an empty proposal (`{}`); every key is then listed as KEPT.
- **The JSON files go through `config-merge.mjs`.** Write the full file you would propose on a first run to a temp file in the session scratchpad, never in the project. Then run the script on it, with absolute paths for the plugin root (the directory two levels above this `SKILL.md`), the project file and the proposal:

  ```sh
  node <plugin root>/scripts/config-merge.mjs --current <project>/grimoire.config.json --proposed <scratchpad>/grimoire.config.json
  node <plugin root>/scripts/config-merge.mjs --current <project>/.claude/settings.json --proposed <scratchpad>/settings.json
  ```

  Without `--write` it writes nothing. It lists each key as one of these:
  - **ADDED**: the current file lacks it.
  - **CHANGED**: both files hold it with different values. It is the user's call, one key at a time.
  - **KEPT**: only the user's file has it. It always stays.

  `repos[]` entries are matched by `name` and `specialists[]` by `agent`, so a hand-edited `repos[api].gate` shows as one CHANGED key, never as a silent overwrite. Permission lists and hook commands are merged as sets: the user's entries stay, and yours are added once. Secrets print as `«redacted»`. The script warns when an added `repos[]` entry sits on another entry's path: a renamed repo would otherwise be kept twice.
- **The Markdown files are never rewritten.** For `CLAUDE.md`, `AGENTS.md`, agent definitions and memory files, propose an append or a diff. A memory file only gains new facts, within its cap. A missing one, for a new agent, is created.
- **The diff is the proposal.** On a re-run, step 2's one-screen proposal is this diff, one for the whole setup, grouped by file: the script's lists for the JSON files, then the proposed appends and diffs. Say what is left alone. Then ask for one yes, and for which CHANGED keys to take. When the user corrects something, update the proposal files, run the dry run again and show the new diff before writing anything. When nothing is added or changed, say the setup is current and write nothing.
- **Write only on a yes.**
  - `grimoire.config.json`: run the same command yourself with `--write` and one `--approve` for each CHANGED key the user accepted, quoted as the script prints it (zsh globs on `[`).
  - `.claude/settings.json` is the user's to apply. The guard closes it to agents: an agent that can edit its own permissions or hooks has no guard. Never write it yourself, through the script or any other route. Print the exact command, with absolute paths for the plugin root, the project file and the proposal in the scratchpad, then `--write` and one quoted `--approve '<path>'` per accepted change. Ask the user to run it themselves (in Claude Code, type `!` before the command). Then run the dry run again: that file is done when it lists nothing ADDED and only the changes the user declined.
  - Added keys are written, and declined and kept keys stay as the user wrote them. A declined change is still a difference, so the next re-run lists it again.

## 1 · Explore (read-only, in one fan-out)

- **Layout.** Is this one repository or a hub of several (a `repositories/` folder, git submodules, a workspace)? For each repo: language, framework, package manager, test runner, lint and typecheck commands, CI workflow jobs.
- **Existing instructions.** `CLAUDE.md`, `AGENTS.md`, `.claude/agents/`, `.claude/skills/`, `docs/`, ADRs, runbooks. Note every invariant, rule and convention already written down; the setup must not duplicate them, it points at them.
- **Gates.** Anything that must pass before a PR and is expensive or machine-global: end-to-end suites (`make e2e*`, `npm run e2e*`), device or emulator tests, contract checks, stamp files, pre-PR hooks. Note the exact command and any path filter that decides whether it applies.
- **Tracker and design tools.** Which issue tracker and design tool the project uses (from docs, MCP configuration, PR templates).
- **Token economy.** Is [rtk](https://github.com/rtk-ai/rtk) installed (`command -v rtk`) and is `rtk hook claude` registered as a `PreToolUse(Bash)` hook in the user's `~/.claude/settings.json` or the project's `.claude/settings.json`? Probe for the status only, never read the file: `grep -q 'rtk hook claude' <file> && echo registered`. It condenses every tool result before it enters context; an unattended loop without it costs several times more.
- **Code graph.** Which languages the repos are written in (the graph extracts relations for TypeScript/JavaScript, Python, Rust, Go, Java, Kotlin, C, C++, C#, Ruby, PHP, Swift), whether Node is ≥ 22.5 (`node --version`; the graph uses `node:sqlite`), and which trees are generated or vendored and should be excluded.
- **Deploy facts.** Which merges deploy to production (CD on main, Vercel-style integrations); those go into memory as facts the reviewer and orchestrator must know.

## 2 · Propose, in one screen

Show the user a single proposal and ask for one yes, or corrections. On a re-run, this proposal is step 0's diff: each item below shows as what it adds, changes or leaves alone.

- **Team agents**, one per repository, from `templates/team-agent.md`: name, stack line, the skills it owns (existing project skills plus any grimoire skill that fits), the gate it must never run, its default model. A team agent the project already has keeps its definition, but if it lacks the template's *Explore before asking; don't guess* section, propose appending it: the rule ships in the plugin's agents, briefs and skills, and the project's own agents must carry it too.
- **`grimoire.config.json`** at the project root, for `/orchestrate`: `repos` (`{ name, path, agent, tags, gate: { run, stamp?, when? } | null, timeoutMin?, laneSetup? }`), `requireHook` (rtk, when installed, with `raw: "rtk proxy"`), `baseBranch` if not `origin/main`, `memoryDir`, `runsDir`. Follow `grimoire.config.example.json` in the plugin. Two fields need care:
  - `timeoutMin` only RAISES the time limits of that repo's writers (implementer, fix, integrate, gate): their soft limit (`agentTimeoutMin`, 40 minutes by default; past it a dispatch is logged late and still awaited, never cut off) becomes `timeoutMin`, and their hard limit (180 minutes; past it a writer is marked wedged and fences the repo) becomes at least twice that. Propose it only when one legitimate writer there runs longer (a gate that queues for a lock); a value at or under 40 does nothing.
  - `laneSetup`: before proposing a symlinked `node_modules`, check that the stack's bundler accepts one pointing outside the project root (Next.js 16's Turbopack does not); otherwise clone it into the lane (`cp -cR`, copy-on-write on APFS).

  Also propose:
  - `specialists`: enable `migration-engineer` for repos that own a schema or migrations, and `test-engineer` where large parts of the code have no tests. Leave it out when neither applies.
  - `deliver: 'end'` on a repo (`repos[].deliver`) whose pre-push hook demands the gate, or whose CI and previews are too costly to run on every landed task: by default the loop pushes each landed task to the repo's draft PR as it lands.
  - `maxOutputTokens`: a per-run cost cap. Propose one and say it is the user's call.
  - `claim.identity`: only when the tracker has an account the loop can act as. The loop writes to the tracker, so it is off unless the user says yes.
  - `telemetry`: the defaults (`.grimoire/runs`, 183 days of retention), and `.grimoire/` added to `.gitignore`.
  - `guard`: the protected branches, when they are not `main`/`master`/`trunk`/`develop`/`release/*`. The plugin's guard hook reads this.
- **Team pinning** in `.claude/settings.json`: `extraKnownMarketplaces.grimoire` (github `laurentlouk/grimoire`) and `enabledPlugins["grimoire@grimoire"] = true`, so every teammate who trusts the folder gets the plugin without prompts, and `/plugin update grimoire@grimoire` is the whole upgrade path.
- **Memory stores**: `memory/harness.md` and `memory/agents/<agent>.md` per team agent, per enabled specialist, plus the reviewer, seeded only with facts you actually found in the docs (dated, declarative, within the caps), never with guesses.
- **Roster**: `AGENTS.md` with the rows filled in.
- **Instructions**: the lines to add to `CLAUDE.md` (the `@memory/harness.md` import, the pointer to `AGENTS.md`). The explore-before-asking rule needs no `CLAUDE.md` line: it is built into every grimoire skill, scout, brief and the team-agent template.
- **Docs**: `docs/specs/`, `docs/plans/`, `docs/crystallize/` if missing.
- **rtk**: if installed but not registered for the project, the `PreToolUse(Bash)` hook entry (`rtk hook claude`) to add to `.claude/settings.json`; if not installed, the one-line install; either way the `requireHook` block for `/orchestrate` so an execute run refuses to dispatch without compression.
- **Scouts**: which grimoire scouts apply (tracker-scout needs a tracker, design-scout a design tool, contract-checker a shared contract; security-scout and perf-scout apply everywhere) and any project-specific scout worth adding.
- **Code graph**: a `graph` block in `grimoire.config.json` (`enabled`, `repos` when only some should be indexed, `exclude` for generated or vendored trees), and the first index once the files are written (`graph_index`, or `node <plugin>/tools/graph/graph.mjs index`), which installs the parser runtime (~50 MB, once per machine) into the user cache. Say in one line what it is for: scouts and the design skills use it to map where things are and how they relate; what code does is always read in the code. If Node is older than 22.5, say the graph is unavailable until it is upgraded, and leave `graph.enabled: false`.
- **Guard hook**: the plugin's `PreToolUse` guard is on once the plugin is enabled. Say what it blocks, in one line (pushes to protected branches, recursive deletes outside the project, agent edits to `.claude/settings*.json` and `.claude/hooks/`), and how to turn it off (`guard.enabled: false`).

State what you could not determine and what you assumed. Do not ask a question you could answer from the repository.

## 3 · Write

On approval, write the files. Do not overwrite an existing `CLAUDE.md`, `AGENTS.md`, agent definition, `grimoire.config.json`, `.claude/settings.json` or memory file. The Markdown ones get an append, or a diff the user applies. `grimoire.config.json` is written by `config-merge.mjs --write`, with an `--approve` for each change the user accepted. `.claude/settings.json` is applied by the user, with the command from step 0. On a first run the current files are missing, so everything in them is added, and the same two routes apply. Verify each agent file has valid frontmatter (`name`, `description`) and that every memory file starts with its header comment and stays within its cap. Finish by listing what was created and the two commands that come next: `/roast <idea>` to start the design pipeline, and `/orchestrate` once a project has been sliced.
