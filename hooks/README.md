# Hooks

Five hooks ship with the plugin (`hooks.json`); the economy hook runs on seven events. All are silent unless they have something to say, and all fail open: a hook that breaks must never wedge a session.

| Hook | Event · matcher | What it does |
| --- | --- | --- |
| `scripts/first-run.sh` | `SessionStart` | One line pointing at `/grimoire:setup` while the project has no `AGENTS.md` and no `memory/`. |
| `scripts/briefing.sh` → `scripts/manager.mjs headline` | `SessionStart` | One line from the latest manager briefing (`.grimoire/manager/latest.md`, the main checkout's in a linked worktree): urgent and ready-for-AI counts, new items, its age, the page when `briefing.html` exists, the sources not checked when it is partial, and "stale" once the next briefing is more than 15 minutes overdue by `manager.schedule` (24 h without one; a week for a cron restricted to some days other than weekdays; a weekdays schedule skips the weekend). Reads files only, never runs a briefing; ids and counts only, never ticket text. Silent with no briefing or a corrupt one. |
| `scripts/guard.sh` → `guard.mjs` | `PreToolUse` · `Bash\|Write\|Edit\|MultiEdit\|NotebookEdit\|mcp__.*` | Blocks a narrow set of irreversible actions, and MCP writes by the plugin's read-only agents, so an unattended loop cannot do them by mistake. |
| `scripts/economy.sh` → `economy.mjs` | `PostToolUse` · `PostToolUseFailure` · `SubagentStop` · `SessionStart` · `SessionEnd` · `UserPromptSubmit` · `Stop` | The stuck watch: folds each subagent call into `.grimoire/economy/turns/<agent_id>.json`, writes a judge request when the gate opens, and feeds each role's envelope from dispatches that ended green. Under shadow (the default) it records what it would redirect or block; under `"loopGuard": "on"` it tells the agent, and watches the main session's turns too. Learned environment facts: folds each finished dispatch and session into its repos' facts, and gives a session started in a repo that repo's block. Answers `{}` except for that block. See "The stuck watch" and "Learned environment facts" below. |
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

## The stuck watch

A dispatched agent can loop: the same failing test, edit after edit, until its time limit. The economy hook watches each subagent's calls (the hook input's `agent_id`; the main session's only under `on`, below) and folds them into that agent's state, `.grimoire/economy/turns/<agent_id>.json`, in the project's main checkout, so worktree lanes share it. The fold and the rules are ported from microsoft/TokenEconomizer (commit `1deb887`, Apache-2.0, `scripts/economy/loopguard/`):

- **What it counts**: edits per file, including edits made through the shell (`sed -i`, redirects into source files, inline Python, `git apply`); error outputs, read from a command's stdout and stderr or a failure's error, never from a file a call read or wrote; verification runs; and how often a failure repeats one seen before, by a signature of its first failure line with numbers and paths masked. A test run whose status a pipe or `||` replaced is judged by its runner's own summary line. rtk's prefix is stripped first.
- **The gate**: after 18 calls, a repeated failure or 8 error outputs. It then writes `.grimoire/economy/judge/<agent_id>.request.json`, holding counts, commands and failure signatures, never file content. The engine's `stuck-judge` dispatch (`workflows/briefs/stuck-judge.md`, while a writer has been in flight past `economy.judgeAfterMin`) rules on it, writes `<agent_id>.result.json` and deletes the request; the verdict, for the current segment, is read on the agent's next call.
- **The free rule**: stuck (churn or scatter, sustained errors, repeated failures, after 20 calls) and past 2.5 times the role's envelope (the backstop): a stuck verdict with no judge. Short of the backstop, a stuck segment is the judge's to rule on. The envelope is the 90th percentile of the role's dispatches that ended green, times 1.25, after 5 of them, per repo and agent type, in `envelope.json`. Until then the free rule is inert for that role. `node scripts/economy/replay.mjs` runs the fold and rules over recorded runs, to see what they would flag (it also counts the envelope tier, where the judge would be asked).
- **What it does**: the first stuck verdict redirects and starts a fresh segment (the agent's fair window to recover); a later one blocks. Under `"loopGuard": "shadow"` (the default in this release) both are only recorded, as `would-redirect` and `would-block` in the state's `events`. Under `"on"` the agent is told, as `additionalContext` answered under the event name the call came in on (`PostToolUse` or `PostToolUseFailure`), which reaches the subagent's own context:
  - the redirect: the judge's `redirect` text, else the template (the agent's own repeated actions mirrored back, asking for a materially different hypothesis, never to stop);
  - then one line telling it to stop and return BLOCKED, its summary starting `STUCK WATCH <agent_id>:`, with what it tried and the reason. The hook writes the watch's record, `judge/<agent_id>.blocked.json` (the reason and the digest). Each step drops the agent's pending judge request, so no judge rules on an ended segment. A judge's text reaches the agent as one line, without backticks or control characters. The loop routes that BLOCKED to its resolve rung, whose scout reads the record; an answer re-dispatches the implementer, none leaves the task to the replanner.
- **The main session, under `on` only**: one turn per prompt, `turns/main-<session_id>.json`, dropped at `UserPromptSubmit` (an interrupted turn never ended green) and closed at `Stop`, which feeds the `<repo>/main` envelope from a turn that ended green. Free rule only, no judge (no engine is there to dispatch one, and a person is there to press Esc): one redirect line as `additionalContext`, then a `systemMessage` to the person.
- **Latency**: the wrapper answers the main session's calls, prompts and stops without starting `node` unless `grimoire.config.json` sets `"loopGuard": "on"` (a `grep`; in a linked worktree the main checkout's config too). A dispatched agent's call costs about 50–60 ms, almost all of it `node`'s startup; the handler's own work is about 0.3 ms (the test's median must stay under 30 ms). No model, no git, no transcript read on a call; the config is read once per agent. One agent's parallel calls fold one at a time, under a per-agent lock.
- **Failing open**: every failure answers `{}` and adds a line to `.grimoire/economy/errors.log` (a malformed input's position only, never its text). Without `node` the wrapper answers `{}`. `GRIMOIRE_ECONOMY=0` turns it off; so does `"economy": {"loopGuard": "off"}` in `grimoire.config.json`. `economy.loopGuardThresholds` pins any threshold (`min_turns`, `gate_min_turns`, `error_outputs`, `backstop_mult`, ...). The envelope is written under a lock; a busy lock drops the sample.
- Stopped agents' states, judge requests, verdicts and block records, and a main-session turn that never reached `Stop`, are kept a week.

## Learned environment facts

Agents keep rediscovering the same things about a repository's environment: the bare `python` has no `pytest`, the project's own interpreter does; a host is unreachable; `git tag` always comes back empty. The economy hook learns these from finished work, with no model, through microsoft/TokenEconomizer's micro-skill families (commit `1deb887`, Apache-2.0, `scripts/economy/facts/`):

- **What it learns**: a failing command form followed by a working one (form repair), a test label that loads only once rewritten (arg repair), an environment variable a later run sets (env value), a host every fetch to fails (boundary), a VCS probe that always comes back empty (empty probe). rtk's prefix is stripped first.
- **When**: at `SubagentStop` (the agent's transcript) and `SessionEnd` (the session's), each dispatch or session once (`facts/folded.json`), into the store of each repo its calls ran in (`.grimoire/economy/facts/<repo>.json`, matched from each call's working directory against `repos[].path`, a git worktree of a repo counting as that repo), under a lock. A busy lock skips a dispatch's fold until its next stop; a session's is skipped for good, and its shown ids are kept a week.
- **Never a secret**: a URL's credentials never reach a host, and an environment variable's value is kept only when its name does not read like a secret (`KEY`, `TOKEN`, `PASS`, `URL`, `DSN`, ...) and the value is a short plain word or path that does not look like a token (a known prefix such as `ghp_`, `sk_` or `AKIA`, or a long run of letters and digits); otherwise the fact names the variable alone.
- **How a fact lives**: active after three confirmations; retired on contradiction; shown only while the failure it prevents keeps occurring, or keeps being prevented, in at least 40 % of the work that exercises it, over at least four. A prevented failure still counts as fired.
- **Where it shows**: at `SessionStart` (`startup`, `clear`, `compact`; never `resume`, which replays the session's own bytes), a session whose directory is inside a repo gets that repo's block, at most 4 facts and about 600 characters, as `additionalContext`. The loop pastes it into each implementer, fix and gate brief of that repo, read once per run; the marker beside it lets this hook count a failure the block prevented in a loop dispatch as fired, as it does for a session. `render-logs.mjs summary` lists the facts active for at least 10 folds (`learnedFacts`), which `crystallize` may propose as memory entries.
- `"economy": {"facts": "off"}` learns and shows nothing, in sessions and in the loop's briefs alike. A fact's history keeps its last 50 folds and each of its count tables its 20 most frequent entries.

## Configuration

Optional `guard` object in `grimoire.config.json` at the project root (`$CLAUDE_PROJECT_DIR`, else the hook input's `cwd`). In a linked worktree with no config of its own it is the main checkout's, and a worktree's own file is layered over it (`scripts/project-config.mjs`), so protections set on main hold in every worktree:

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

Run the tests with `node hooks/scripts/guard.test.mjs` and `node hooks/scripts/economy.test.mjs`.
