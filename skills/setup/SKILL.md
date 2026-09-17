---
name: setup
description: First-run setup of the grimoire harness in an existing project. Use right after installing the plugin, or when the user says "set up grimoire", "create the agents for this project", "bootstrap the harness". Explores the repositories, proposes a team agent per repo, the memory stores, the roster (AGENTS.md), the loop's repos configuration with its gates, and the CLAUDE.md lines, then writes them on the user's approval.
---

# Set up the harness in this project

Everything the harness needs is derivable from the project except the decisions that are the owner's. Explore first, propose once, write on a yes.

## 1 · Explore (read-only, in one fan-out)

- **Layout.** Is this one repository or a hub of several (a `repositories/` folder, git submodules, a workspace)? For each repo: language, framework, package manager, test runner, lint and typecheck commands, CI workflow jobs.
- **Existing instructions.** `CLAUDE.md`, `AGENTS.md`, `.claude/agents/`, `.claude/skills/`, `docs/`, ADRs, runbooks. Note every invariant, rule and convention already written down; the setup must not duplicate them, it points at them.
- **Gates.** Anything that must pass before a PR and is expensive or machine-global: end-to-end suites (`make e2e*`, `npm run e2e*`), device or emulator tests, contract checks, stamp files, pre-PR hooks. Note the exact command and any path filter that decides whether it applies.
- **Tracker and design tools.** Which issue tracker and design tool the project uses (from docs, MCP configuration, PR templates).
- **Token economy.** Is [rtk](https://github.com/rtk-ai/rtk) installed (`command -v rtk`) and is `rtk hook claude` registered as a `PreToolUse(Bash)` hook in the user's or the project's `.claude/settings.json`? It condenses every tool result before it enters context; an unattended loop without it costs several times more.
- **Deploy facts.** Which merges deploy to production (CD on main, Vercel-style integrations); those go into memory as facts the reviewer and orchestrator must know.

## 2 · Propose, in one screen

Show the user a single proposal and ask for one yes, or corrections:

- **Team agents**, one per repository, from `templates/team-agent.md`: name, stack line, the skills it owns (existing project skills plus any grimoire skill that fits), the gate it must never run, its default model.
- **Repos configuration** for `/orchestrate`: `{ name, path, agent, tags, gate: { run, when? } | null, prBy }` per repo, with `baseBranch` if the integration branch is not `origin/main`.
- **Memory stores**: `memory/harness.md` and `memory/agents/<agent>.md` per team agent plus the reviewer, seeded only with facts you actually found in the docs (dated, declarative, within the caps), never with guesses.
- **Roster**: `AGENTS.md` with the rows filled in.
- **Instructions**: the lines to add to `CLAUDE.md` (the `@memory/harness.md` import, the pointer to `AGENTS.md`, the explore-before-asking paragraph if it is not already there).
- **Docs**: `docs/specs/`, `docs/plans/`, `docs/crystallize/` if missing.
- **rtk**: if installed but not registered for the project, the `PreToolUse(Bash)` hook entry (`rtk hook claude`) to add to `.claude/settings.json`; if not installed, the one-line install; either way the `requireHook` block for `/orchestrate` so an execute run refuses to dispatch without compression.
- **Scouts**: which grimoire scouts apply (tracker-scout needs a tracker, design-scout a design tool, contract-checker a shared contract) and any project-specific scout worth adding.

State what you could not determine and what you assumed. Do not ask a question you could answer from the repository.

## 3 · Write

On approval, write the files. Do not overwrite an existing `CLAUDE.md`, `AGENTS.md` or agent definition; append or show the diff and let the user apply it. Verify each agent file has valid frontmatter (`name`, `description`) and that every memory file starts with its header comment and stays within its cap. Finish by listing what was created and the two commands that come next: `/roast <idea>` to start the design pipeline, and `/orchestrate` once a project has been sliced.
