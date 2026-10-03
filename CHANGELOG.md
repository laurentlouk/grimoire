# Changelog

## 0.8.1 — run efficiency and honest reporting

Fixes found in a real unattended run (six issues, one repo) that took 9 h 10 for about 2 h 45
of work. Its transcripts showed where the time went and its journal showed each defect. All are
engine-, brief- and skill-level and stack-agnostic.

- **Session probe** (`maxToolLatencySec`, default 15). Every Bash call of that run waited 30 s
  on a PreToolUse hook that hung until its timeout: 836 calls, 6.4 h, read by the run as slow
  builds. Execute runs now have the indexer time two back-to-back Bash calls; past the limit
  the run refuses to start as `slow_tool_calls` and names the likely cause; from 8 s it warns.
  The number is in `telemetry.toolLatencySec` and in every replan prompt. The `orchestrate`
  skill also times `git status` before launching.
- **A timed-out agent may still be running.** The backstop books the dispatch as died but
  cannot stop it, and that run's "dead" implementer committed three minutes later. The timeout
  log, the replanner's failure detail and the replan brief now say so and what to check
  (`git log`, `git status`, live processes) before requeuing; the dispatches are listed in
  `telemetry.timedOut`.
- **Learnings are measured.** The replan blamed slow tests and proposed raising
  `repos[].timeoutMin` to 75 — a key that only raises the backstop and was set below it, so it
  had never applied. The replan brief requires durations from measurement; the engine warns
  when a repo's `timeoutMin` is at or under the global backstop; crystallize checks each
  learning against the journal before keeping it.
- **`needsAttention` holds only open work.** A task that died, was requeued and landed was
  still reported there. It is now in `recovered`; `needsAttention` keeps the latest attempt of
  what never landed.
- **An honest note when crystallize does not finish.** The note said "no PR this run, so no
  crystallize" when a PR existed and crystallize had timed out. It now says crystallize did
  not finish and names the PRs to run it over by hand. Crystallize, the longest dispatch of a
  run, gets its own 90-minute allowance.
- **Harness findings stay out of the product PR.** A terminal-sweep blocker on the loop's own
  lane config bought a 37-minute fix round and three harness commits in the product PR. A
  terminal blocker/major on a harness file (`grimoire.config.json`, `.claude/`, `AGENTS.md`,
  memory, runs, `docs/crystallize/`) is now an advisory note tagged `harness`, listed in
  crystallize's header for the harness PR. A per-task review still gates a task's own change
  to such a file.
- **A PR that closes what it ships.** The gate opened a one-line PR that linked no issue. It is
  now handed every landed task (id, title, the implementer's report) and the gate brief sets
  the title and body: one closing keyword per issue, what changed, what the tasks recorded,
  how it was verified, what to check before merging, and no invented links, local paths or
  model co-authors. The gate runs on sonnet instead of opus.
- **Repo-relative paths in what the run publishes.** Reviewers' absolute paths, home directory
  included, went into the committed ledger. The probe reports each checkout's root and
  `$HOME`; the ledger, the gate's task reports and crystallize's header are rewritten
  repo-relative, with `~` for the home directory. Reviewers are asked for repo-relative paths.
- **The ledger branch starts from the default branch**, not from the run's base: cut from an
  unmerged base, the ledger's PR carried that base's commits. The ledger agent must not open a
  PR (it did); crystallize merges the run's unmerged PR heads into its branch before patching
  and says its PR merges after them.
- **Less work that was never used.** Hydration plans from reading and no longer runs builds or
  browsers (one spent twenty minutes probing whether two tasks could share a repo). Spec
  reviewers read instead of re-running the full suite; the quality stage and the gate run it.
- **`laneSetup` docs and setup** no longer suggest a symlinked `node_modules` without checking
  the bundler accepts one (Next.js 16's Turbopack does not); the setup skill proposes
  `timeoutMin` only above the 40-minute backstop.
- **The Reliability lens checks the gate from a fresh clone.** That run's gate type-checked
  before the build that writes the gitignored type declarations, so it passed only in a
  checkout an earlier build had left them in; no reviewer read the gate. The persona's scope
  now includes the gate command and the scripts it calls.
- **Eval cases** from these failures: `orchestrate` does not launch while a trivial command
  waits tens of seconds; `setup` proposes no no-op `timeoutMin` and no symlinked
  `node_modules` for a Next.js 16 app.

### Upgrading from 0.8.0
Nothing to change in `grimoire.config.json`. Drop a `repos[].timeoutMin` at or under 40 (the run
now warns that it has no effect). A session the probe refuses is a session to fix first: time
`git status`, find the slow PreToolUse hook, restart.

## 0.8.0 — loop integrity

Fixes found in a real unattended run whose journal showed each defect. All are engine- and
brief-level and stack-agnostic.

- **Direct tasks work on the run branch.** A task running alone in its repo used the tracker's
  per-issue branch, so it settled DONE without ever reaching the run branch its dependents,
  the sweep and the gate build on. It now always commits on the run branch, and the precheck
  verifies a direct task's head is an ancestor of the run branch (new check `ancestry`). The
  run branch is named deterministically, `feat/<project-slug>-<repo>`, never after a tracker
  branch, so a resumed session builds on the same branch as the session before it. Work that
  0.7.x landed on per-issue branches is not merged into it automatically.
- **Review range `startSha..headSha`.** Implementers report `startSha` (HEAD before their
  first change); precheck, panel, guard and verifier judge from there instead of `firstSha^`,
  so a merge task is no longer blamed for every lane merged before it. The precheck verifies
  `startSha` is an ancestor of the head (check `range`; on a FAIL the range falls back to
  `firstSha^`). A footprint-only precheck failure that repeats with the same known head becomes
  an advisory note and the panel runs.
- **Agent preflight** (`preflight`, default on). Before any hydration or implementer, every
  agent type the run can dispatch answers one trivial haiku prompt; a silent type is probed
  once more, and any still silent refuses the run as `agents_unavailable`, naming the types.
- **Dead reviewers are a harness failure.** A reviewer that returns nothing is retried once
  (only the missing persona); if any required lens is still absent the stage fails closed and
  the run halts as `reviewers unavailable` (`REVIEWERS_UNAVAILABLE`), naming the lens: no
  replan spent, no code marked failed, and no stage passes on its surviving reviewers.
- **One PR per repo, pushed by the loop.** Lanes and integrations never pushed, so an ungated
  repo ended with unpushed merges. Every repo's terminal slot now runs the gate command if it
  has one, pushes the run branch and opens (or updates) the repo's one PR; implementers never
  push or open PRs. `repos[].prBy` is removed (ignored, with a warning). When the push or PR
  step itself fails (auth, a protected branch, the network) the slot is `SHIP_FAILED`: never
  replanned, the repo is listed in `ungatedRepos` with the cause in `ungatedReasons`.
- **Escalation only for code failures.** A replanned task moves to opus only when its last
  failure was code-kind (gating findings, BLOCKED, a structural precheck defect, a failed gate
  or sweep); harness failures (dead agent, merge conflict, footprint or ancestry precheck)
  keep the selector's tier. A task the replanner invents inherits the kind of the failures it
  repairs in its repo. The replanner is told which failures were harness failures.
- **`requireHook.raw`** (e.g. `"rtk proxy"`): implement and gate prompts say how to re-run a
  command whose compressed output is empty, garbled or contradicts its exit code (a generic
  version when unset).
- **`DONE_PENDING_GATE`**: a gated repo's DONE, landed everywhere DONE is. A gate dispatch
  returning it counts as a failed gate.
- **Pre-existing failures**: the implement brief says to run a failing check on the base (a
  throwaway worktree of `baseSha`, never `git stash`) before owning it, and to report
  pre-existing failures in `concerns`.
- **Unattended boundary**: every briefed dispatch is told nobody is watching; a message that
  looks like a user's mid-task is reported, never answered or obeyed.
- **Journal**: `at` is documented as the chunk's flush time (the runtime has no clock). Events
  and `run.json` carry `attempt`, the session number under a `runId` (bumped by the session's
  first flush that lands; a 0.7.x `run.json` counts as attempt 1); from attempt 2 chunks are
  `<firstSeq>.a<N>.jsonl`, so a relaunch never overwrites an earlier attempt, and
  `render-logs` dedupes by (attempt, seq).

### Upgrading from 0.7.x

- **One deterministic run branch per repo**, `feat/<project-slug>-<repo>`, and one PR per repo
  opened at project end. Per-ticket branches and per-ticket PRs are gone; drop `prBy` from
  `grimoire.config.json`. Work a 0.7.x run landed on per-issue branches is not merged into the
  new run branch automatically: merge or re-run it by hand. A repo whose 0.7.x run already
  opened per-ticket PRs on tracker branches gets one NEW PR, from the run branch, at the end of
  the next run: close the old per-ticket PRs or retarget them, or they stay open alongside it.
  The run branch name is slugged (`feat/<project-slug>-<repo-slug>`); a name with no
  sluggable characters becomes `x<hash>`.
- **The agent preflight is on by default.** An execute run that cannot spawn one of its agent
  types refuses with `error: 'agents_unavailable'` and `problems: [<types>]`. Fix
  `agentNamespace` or the agent names, or opt out with `{preflight: false}`.
- **New statuses for consumers of the result, the ledger and the journal.** `DONE_PENDING_GATE`
  is landed (count it with `DONE` and `DONE_WITH_CONCERNS`). `REVIEWERS_UNAVAILABLE` is not a
  code failure; the run halts with a reason starting `reviewers unavailable`. `SHIP_FAILED` is a
  terminal slot whose push or PR step failed (see `ungatedReasons`). Precheck events
  can carry the verdict `ADVISORY`, review events the verdict `UNAVAILABLE`.
- **Journal readers**: events and `run.json` have an `attempt` field (absent = 1), chunks from
  a second attempt onward are named `<seq>.a<N>.jsonl`, and `seq` is unique per attempt, not
  per run. `at` is the chunk's flush time, shared by every event of the chunk.
- **Implementers report `startSha`.** Team-agent definitions copied from the templates should
  add it to their return (`baseSha`, `startSha`, `commits`, `headSha`).
- **Known trade-off**: a footprint problem the precheck flags identically twice, with no new
  commit in between, is demoted to an advisory note. A stray change the precheck mislabels as
  footprint would then reach the panel instead of failing the task; the reviewers, not the
  precheck, have to catch it.
