---
name: setup
description: First-run setup of the grimoire harness in an existing project, and its re-run as an update. Use right after installing the plugin, or when the user says "set up grimoire", "create the agents for this project", "bootstrap the harness", "re-run setup", "update the grimoire setup". Explores the repositories, proposes a team agent per repo, the memory stores, the roster (AGENTS.md), the loop's repos configuration with its gates, the manager briefing's tracker sources bound to read-only official tools, and the CLAUDE.md lines, then writes them on the user's approval. On a project already set up, it shows one diff of what it would add, change or keep, and writes only what the user approves.
---

# Set up the harness in this project

Everything the harness needs is derivable from the project except the decisions that are the owner's. Explore first, propose once, write on a yes.

## 0 · Migration mode and re-runs

**Migration.** If the project already carries copies of what the plugin ships — skills named like grimoire's (`roast`, `to-plan`, `to-issues`, `implement`, `review`, `crystallize`, `orchestrate`, `launch-agent`, `tdd`, `adaptive-replanning`, `setup`, `logs`), agents named like grimoire's scouts, specialists and reviewer, a `.claude/workflows/` with `orchestrate-loop.js`, or a memory README — list them as **duplicates the plugin now provides** and propose deleting them, so a plugin update reaches the project without a second copy drifting. Keep anything project-specific: team-agent definitions, memory data files, stack skills, hooks, docs. Never delete without the user's yes.

**Re-run.** When the project already has a `grimoire.config.json`, `.claude/settings.json`, `memory/`, `.claude/agents/`, `AGENTS.md` or `CLAUDE.md`, the run updates what is there. Read them first (the two JSON files only through the script), before exploring. What they hold is the user's choice, including what they edited by hand: re-derive a value only when the code shows it is stale, and say so.

- **Secrets are referenced, never read.** Do not open `.env*`, credential or key files. Never read `.claude/settings.json`, `.claude/settings.local.json`, `~/.claude/settings.json` or `.mcp.json` raw: they can hold tokens in `env`, in permission rules, in hook commands and in a server's `headers` (`Authorization: Bearer …`). Name the variable or the file that holds a secret, never its value. The script's output masks them: every `env` value, every value under a key named like a token, key, password, credential or auth, and bearer tokens, URL credentials and known token formats inside any string. To see a JSON file before you propose anything, diff it against an empty proposal (`{}`); every key is then listed as KEPT. A git remote can carry a token too (`https://<token>@github.com/…`): read one only with the credentials stripped as it is read, `git -C <path> remote get-url origin | sed -E 's#(https?://)[^/@]*@#\1#'`, never bare.
- **The JSON files go through `config-merge.mjs`.** Write the full file you would propose on a first run to a temp file in the session scratchpad, never in the project. Then run the script on it, with absolute paths for the plugin root (the directory two levels above this `SKILL.md`), the project file and the proposal:

  ```sh
  node <plugin root>/scripts/config-merge.mjs --current <project>/grimoire.config.json --proposed <scratchpad>/grimoire.config.json
  node <plugin root>/scripts/config-merge.mjs --current <project>/.claude/settings.json --proposed <scratchpad>/settings.json
  node <plugin root>/scripts/config-merge.mjs --current <project>/.mcp.json --proposed <scratchpad>/empty.json
  ```

  The last one only reads: `<scratchpad>/empty.json` holds `{}`, and setup never writes `.mcp.json`.

  Without `--write` it writes nothing. It lists each key as one of these:
  - **ADDED**: the current file lacks it.
  - **CHANGED**: both files hold it with different values. It is the user's call, one key at a time.
  - **KEPT**: only the user's file has it. It always stays.

  `repos[]` entries are matched by `name`, `specialists[]` by `agent` and `manager.sources[]` by `id`, so a hand-edited `repos[api].gate` or `manager.sources[linear].scope` shows as one CHANGED key, never as a silent overwrite. Permission lists and hook commands are merged as sets: the user's entries stay, and yours are added once. Secrets print as `«redacted»`. The script warns when an added `repos[]` entry sits on another entry's path: a renamed repo would otherwise be kept twice.
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
- **Tracker and design tools.** Which issue tracker and design tool the project uses (from docs, MCP configuration, the session's connectors, PR templates, git remotes, `toolHints.tracker`). For each tracker, also what "The manager section" below detects: its scope, its labels and their descriptions, and whether a read reaches it.
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
  - `manager`: the briefing's sources, repo labels, priority labels and thresholds, built and probed as "The manager section" below says, with the permission rules and the tracker writes it needs listed in the same diff.
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

On approval, run the tracker writes the user named (the priority labels below), one at a time, and report each result. Then write the files. Do not overwrite an existing `CLAUDE.md`, `AGENTS.md`, agent definition, `grimoire.config.json`, `.claude/settings.json` or memory file. The Markdown ones get an append, or a diff the user applies. `grimoire.config.json` is written by `config-merge.mjs --write`, with an `--approve` for each change the user accepted. `.claude/settings.json` is applied by the user, with the command from step 0. On a first run the current files are missing, so everything in them is added, and the same two routes apply. Verify each agent file has valid frontmatter (`name`, `description`) and that every memory file starts with its header comment and stays within its cap. Finish by listing what was created and the two commands that come next: `/roast <idea>` to start the design pipeline, and `/orchestrate` once a project has been sliced. When a `manager` block was written, add `/grimoire:manager` for the first briefing.

## The manager section

`/grimoire:manager` reads the trackers through the sources bound here. This section runs inside steps 1 to 3, through the same diff: on a re-run the current `manager` block is the user's, so what they set stays unless they approve a change, and a value is re-derived only when the project shows it is stale.

**Detect** which trackers the project uses, from:
- the docs, `CLAUDE.md`, `AGENTS.md` and PR templates (ticket keys such as `ENG-123`, tracker links);
- `.mcp.json`, only through `config-merge.mjs` against `{}` (step 0), and the session's connectors (ToolSearch: "linear", "jira", "atlassian", "github");
- each repo's remote, read stripped as step 0 says (`git -C <path> remote get-url origin | sed -E 's#(https?://)[^/@]*@#\1#'`), and whether its GitHub Issues are in use (`gh issue list --repo <owner/repo> --limit 1`);
- the config's `toolHints.tracker` and `claim`.

A GitHub remote alone makes a `prs` source, not a tracker. GitHub Issues is a tracker source only when the project tracks its work there.

**Official tools only.** A source binds to the vendor's own tool or a claude.ai connector: Linear's MCP, Atlassian's MCP, GitHub's MCP or `gh`. Never a community MCP server or a third-party CLI, even one the project already configures: name it and say why it is left out. Grimoire ships no API client.

**Sources** (`manager.sources[]`): one per tracker, then `prs` and `runs`.

```json
{ "id": "linear", "category": "tracker", "kind": "linear", "hint": "mcp__<server-id>__* (Linear, the claude.ai connector)", "readOnly": "guard", "scope": { "teams": ["ENG"] }, "verifiedAt": "2026-10-16T09:30:00Z" }
```

- `id` is unique: it becomes the WorkItems' `sourceId`. `category` is `tracker`, `prs` or `runs`. `kind` is `linear`, `jira` or `github` (`grimoire` for runs). On a re-run, a detected source whose kind and scope match a current one takes that one's id, so a hand-renamed id is not proposed again as a second source.
- `hint` uses the `toolHints` format: the route and what it reaches. A connector's server id belongs to this account; a teammate's session finds its own through the scouts' fallback (another connector via ToolSearch, then a CLI). Name a secret by its variable, never its value.
- `scope`: Linear `teams` (keys), Jira `projects` (keys), GitHub `repos` (`owner/repo`). Take it from the docs, the ticket keys and the remotes. Ask only when several teams or projects fit and nothing says which.
- `readOnly`: what holds the source read-only **now**, through the route the hint names.
  - `endpoint`: the route already is the vendor's read-only endpoint (Linear `https://mcp.linear.app/mcp/readonly`, GitHub `https://api.githubcopilot.com/mcp/x/issues/readonly`).
  - `flag`: the route already is GitHub's local server started with `--read-only`.
  - `admin-group`: the account it connects as can only read, such as an Atlassian service account in a read-only group, or a read-only API key.
  - `permission-rule`: `gh` for issues, held by the rules below.
  - `guard`: a claude.ai connector, which has no read-only variant. Only the guard's MCP rule holds the scouts read-only.

  Record `endpoint` or `flag` only when the current route already uses it. Where a stronger route exists, propose it separately, as a change the user applies to their server entry (like the settings): the source keeps the value that holds today until the route has changed and been probed.
- `prs`: one source for every GitHub remote in `repos[]` (`kind: github`, through `gh`, `scope.repos` with one `owner/repo` per remote). Its `readOnly` is `guard`: `gh pr create` and `gh pr edit` stay open for the loop, so what holds it is the scout's instructions, plus the guard when it reads through GitHub's MCP.
- `runs`: always `{ "id": "runs", "category": "runs", "kind": "grimoire" }`, the run journals under `telemetry.dir`.

**The rules for `gh`**, proposed in `.claude/settings.json` (the user applies it, step 0). They bind every session in the project, the main one, `to-issues` and the loop's claims included, not only the scouts:
- `permissions.deny`: `Bash(gh issue close:*)`, `Bash(gh issue delete:*)`, `Bash(gh issue transfer:*)`, `Bash(gh pr merge:*)`, `Bash(gh pr close:*)`. Nothing in the pipeline runs these: an issue closes through its PR's `Closes #N`, merging stays a person's, and nothing closes a PR.
- `permissions.ask`: `Bash(gh issue create:*)`, `Bash(gh issue edit:*)`, `Bash(gh issue comment:*)`, `Bash(gh api -X:*)`, `Bash(gh api --method:*)`. `to-issues` creates and links issues, and claims assign and comment, so these prompt instead of refusing. With `claim.identity` set on a GitHub tracker, an unattended run cannot answer those prompts for its claims: say so, and let the user choose.

A rule matches how a command starts, so it is a backstop: `gh api <path> --method POST` and `gh api <path> -X POST` (the flag after the path) slip past the `-X` rules, and `gh api … -f` posts without any flag. The scout's instructions come first. `gh pr create`, `edit`, `comment` and `ready` stay open, because the loop ships through them.

**Repo labels** (`manager.repoLabels`, a tracker label → a `repos[].name`). When the tracker's labels name repos, the briefing routes an issue by its label before any judgment. List the labels with their descriptions (Linear `list_issue_labels` for the team, Jira's labels or components, `gh label list --limit 200 --json name,description`: the default of 30 can hide a repo's priority labels).
- A label maps to a repo when its description names that repo's stack or role as step 1 found it, or its name is the repo's name and its description doesn't point elsewhere.
- The description wins over the name. A `frontend` label that reads "React Native mobile app" maps to the mobile repo, not the web app.
- A label the descriptions don't tie to one repo (no description, or two candidates) is left out, and the proposal lists it as unmapped. Never guess one.

Show the map for confirmation. A single-repo project needs none.

**Priority** (`manager.priorityLabels`, for a GitHub tracker, which has no priority field). Propose the defaults on Linear's scale (1 urgent … 4 low): `{ "priority: urgent": 1, "priority: high": 2, "priority: medium": 3, "priority: low": 4, "P0": 1, "P1": 2, "P2": 3, "P3": 4, "critical": 1 }`. Add the repo's own priority labels whose name states a level (`p1`, `prio/high`, `sev1`, `blocker`).

When a repo has none of them, every issue reads as unknown priority, so offer to create the four `priority:` labels:

```sh
gh label create "priority: urgent" --repo <owner/repo> --color B60205 --description "Manager briefing: priority 1"
```

High is `D93F0B`, medium `FBCA04`, low `0E8A16`. This is a write to the tracker. List it in the one diff under "Tracker writes", as its own decision. A general yes to the diff does not take it: run it only when the user's answer names the labels. Never create, rename or apply a label otherwise.

**Defaults:** `urgent: { "priorityAtMost": 2, "dueWithinDays": 2, "blocksAtLeast": 2, "stalledDays": 5 }` and `maxItemsPerSource: 200`. The schedule, the shared post and the budget come with their own steps: leave them out.

On a re-run, build `urgent`, `priorityLabels` and `maxItemsPerSource` from the current block, not from step 0's first-run proposal. `urgent` and `maxItemsPerSource` take a default only for a key the block lacks. `priorityLabels` takes the defaults only when the block has none, and otherwise gains only the repo's new priority labels. A value the user set then never shows as CHANGED back to a default.

**Hub remotes** (`repos[].remote`, optional). In a hub whose repos are nested clones, record each repo's remote, read stripped as step 0 says (`git -C <path> remote get-url origin | sed -E 's#(https?://)[^/@]*@#\1#'`), so a token never enters the context. The fix for a missing clone can then name its URL. The loop ignores the key.

**Probe before proposing.** Read each source once through its own route, read calls only:
- Linear: `list_issues` for the team, limit 1.
- Jira: one issue by JQL in the project.
- GitHub: `gh issue list --repo <owner/repo> --limit 1 --json number`, and for `prs`, `gh pr list` the same way, for each repo in scope.
- `runs`: `node <plugin root>/scripts/render-logs.mjs summary --dir <telemetry.dir> --json`.

A source that **passes** gets `verifiedAt`, the probe's time in ISO 8601 UTC, when it is added or its `kind`, `hint` or `scope` changes. One that passes again unchanged keeps its current `verifiedAt`, so a re-run that changes nothing stays current. When the user corrects a source's scope or hint during the proposal, probe it again before it gets a `verifiedAt`.

A source that **fails** is shown in the diff with the error in one line and its fix (authorize the connector in claude.ai's settings, `gh auth login`, `gh auth refresh -s repo`, the right team key). It is not written. A new one is left out, and an existing one stays as it is, unless the user says to write it anyway, then without a new `verifiedAt`.
