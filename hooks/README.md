# Hooks

Four hooks ship with the plugin (`hooks.json`). All are silent unless they have something to say, and all fail open: a hook that breaks must never wedge a session.

| Hook | Event · matcher | What it does |
| --- | --- | --- |
| `scripts/first-run.sh` | `SessionStart` | One line pointing at `/grimoire:setup` while the project has no `AGENTS.md` and no `memory/`. |
| `scripts/briefing.sh` → `scripts/manager.mjs headline` | `SessionStart` | One line from the latest manager briefing (`.grimoire/manager/latest.md`, the main checkout's in a linked worktree): urgent and ready-for-AI counts, new items, its age, the page when `briefing.html` exists, the sources not checked when it is partial, and "stale" once the next briefing is more than 15 minutes overdue by `manager.schedule` (24 h without one; a week for a cron restricted to some days other than weekdays; a weekdays schedule skips the weekend). Reads files only, never runs a briefing; ids and counts only, never ticket text. Silent with no briefing or a corrupt one. |
| `scripts/guard.sh` → `guard.mjs` | `PreToolUse` · `Bash\|Write\|Edit\|MultiEdit\|NotebookEdit\|mcp__.*` | Blocks a narrow set of irreversible actions, and MCP writes by the plugin's read-only agents, so an unattended loop cannot do them by mistake. |
| `scripts/graph-refresh.sh` | `SubagentStop` · async | Re-indexes the code graph after every subagent (an implementer's commit, an integrate merge), with the deterministic indexer, never a model: `tools/graph/graph.mjs refresh`. Runs in the background, so nothing waits on it. |

## The guard

The build loop runs agents unattended for hours. The guard is a seatbelt for the few actions that cannot be undone from a PR: it reads the tool call Claude Code passes on stdin and, on a match, exits `2` with one line on stderr starting `grimoire guard:`. Claude Code skips the call and shows the line to the agent, which is told how to proceed. Anything else exits `0` with no output, and the normal permission flow applies.

**Bash**

- `git push` that targets a protected branch: `origin main`, `HEAD:main`, `+main`, `x:refs/heads/main`, `:main`, `--delete main`, forced or not; a bare `git push` / `git push origin HEAD` while the checkout is on a protected branch; any `--mirror` or `--all`. Feature branches push freely, force included.
- `git branch -d/-D/--delete` of a protected branch, and `git worktree remove` of the checkout that holds one.
- Recursive `rm` (`-r`, `-R`, `--recursive`, with or without `-f`) of `/`, `~`, `$HOME`, `.`, `..`, `*`, the project's `.git`, the project directory or a parent of it, or any path outside the project. Paths inside the project (`node_modules`, `.worktrees/…`, `build/*`) and inside the temp directories (including the session scratchpad) are allowed.

Commands are split the way the shell would (`;`, `&&`, `||`, `|`, newlines, `$(…)`, backticks, `bash -c`, `eval`, `sudo`/`env`/`xargs` prefixes, `cd` before the command). Quoted text is data: `echo "git push origin main"` and a heredoc commit message that mentions `rm -rf /` are allowed.

**Write · Edit · MultiEdit · NotebookEdit**

- The project's `.claude/settings.json`, `.claude/settings.local.json`, `.claude/hooks/`, and every `guard.protectedPaths` entry (a root `hooks/` is left alone: many app layouts keep source code there). An agent that can edit its own permissions or the guard has no guard.
- The same paths in every linked git worktree of the project's repository (a loop lane under `.worktrees/`, a session worktree anywhere): a lane is judged as the project itself.
- `<memoryDir>/` when the writing subagent is a named roster agent: the plugin's scouts and `reviewer`, plus every `repos[].agent` in `grimoire.config.json` (and `guard.memoryDeniedAgents`). Memory is written only by the `crystallize` step. Claude Code sets `agent_type` on the hook input inside a subagent, but the loop dispatches `crystallize` as a generic subagent and humans run it in the main session, so the rule names who may not write rather than who may. The main session and generic subagents are never blocked.

**MCP tools (`mcp__<server>__<tool>`)**

- A write by a read-only agent: the subagent's `agent_type` (namespace stripped, so `grimoire:tracker-scout` is `tracker-scout`) is one of the plugin's scouts or `reviewer`, and the tool's first known verb is a write. The scouts read trackers through whatever connector the session has, and a plugin can't ship permission deny rules for tool ids it can't know, so read-only is enforced here. The agent is told which verb decided, and to report the proposed write in its result; the main session applies writes.
- The tool part is what follows the last `__`, once trailing `_` are dropped: a server id can hold `_`, `-` and digits (`mcp__plugin_grimoire_graph__graph_search` is the tool `graph_search`, `mcp__055f8362-1877-48fa__save_issue` is `save_issue`, and so is `mcp__a__save_issue__`). Only its first 64 characters are read.
- The tool part is read as words, split on any character that is not a letter or digit (in practice `_` and `-`) and on camelCase boundaries, then lowercased (`createJiraIssue` is create, jira, issue). Walking them in order, the first word that is a known verb decides:
  - a read verb allows: `get`, `list`, `search`, `read`, `fetch`, `find`, `query`, `view`, `show`, `describe`, `count`, `aggregate`, `lookup`, `check`, `status`, `inspect`, `analyze`, `explain`, `export`, `download`;
  - a write verb denies: `save`, `create`, `update`, `delete`, `send`, `reply`, `share`, `submit`, `resolve`, `trash`, `label`, `respond`, `upsert`, `exec`, `run`, `pause`, `stop`, `start`, `invalidate`, `sync` and the rest of `WRITE_VERBS` in `guard.mjs` (89 in all). `issue`, `verify` and `test` are left out on purpose: they read as nouns or reads too often.
  - So `slack_send_message` is a write (`slack` is no verb, `send` is), `list_task_runs` a read (`list` comes first), and a name with no known verb (`graph_index`) passes. Only whole words count: `saved`, `forwarding` and `labels` are not verbs.
- The implementers (`migration-engineer`, `test-engineer`), generic subagents and the main session are never blocked by this rule. Nor is a project's own agent that `grimoire.config.json` names in `repos[].agent` or `specialists[].agent`, even one that shares a plugin agent's bare name: an `agent_type` of `reviewer` (no namespace) is the project's and passes, while `grimoire:reviewer` is the plugin's and stays bound.

## Configuration

Optional `guard` object in `grimoire.config.json` at the project root (`$CLAUDE_PROJECT_DIR`, else the hook input's `cwd`):

```json
"guard": {
  "enabled": true,
  "protectedBranches": ["main", "master", "trunk", "develop", "release/*"],
  "protectedPaths": ["infra/secrets/", "Makefile"],
  "memoryDir": "memory",
  "memoryDeniedAgents": []
}
```

- `protectedBranches` replaces the default list shown above (`*` matches anything, `/` included). The top-level `baseBranch`, minus `origin/`, is always added.
- `protectedPaths` are relative to the project root; a trailing `/` marks a directory, and a plain entry also covers anything beneath it.
- `memoryDir` falls back to the top-level `memoryDir`, then `memory`.
- `enabled: false` turns the guard off. A missing or malformed config means the defaults; the guard never fails closed on its own bugs.

## Overriding

- **Branch and `rm` rules**: run the command yourself outside the agent, or change `guard.protectedBranches`.
- **Path and memory rules**: make the edit yourself, or start the session with `GRIMOIRE_GUARD_ALLOW=1` in its environment.
- **MCP rule**: let the main session make the write from the scout's report, or start the session with `GRIMOIRE_GUARD_ALLOW=1`.

## Limits

A seatbelt, not a sandbox. It sees one tool call at a time and pattern-matches what a well-meaning agent does by mistake; it does not stop a determined one. Not covered: writes to protected files through Bash (`sed -i`, `>`, `cp`), `git clean`, `find -delete`, `rm` targets built from variables or read from stdin (`rm -rf "$DIR"`, `xargs rm -rf` are allowed because they cannot be judged), symlinks that point outside the project, pushes through aliases or scripts, and memory writes inside a worktree of the orchestrating repo. The MCP rule reads verbs, a heuristic: a write whose verb is not on the list still passes (`issue_cert`, `verify_project_domain`, `test_drain`, and `push_files` and `fork_repository`, since `push` and `fork` are not on it), so does one whose first known verb is a read (`rerequest_check`), and a read whose first known verb is a write is refused (`comment_count`, `verify_upload`, `resolve-library-id`, `execute_sql`, `run_query`); a tool name that itself holds `__` is judged by its last part. It binds only the plugin's read-only agents, by the `agent_type` Claude Code sets inside a subagent: the main session is not restricted, and a scout's write through Bash (`gh`, `curl`) is not seen. Without `node` on `PATH` the wrapper exits `0` and nothing is guarded. Branch protection on the remote remains the real control; this only keeps the loop from needing it.

Run the tests with `node hooks/scripts/guard.test.mjs`.
