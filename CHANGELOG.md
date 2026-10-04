# Changelog

## 0.9.0 — run durability

Fixes found in a real unattended run (one static-site repo, ten issues in a strict blocked-by
chain, `maxPerRepo` 1, on 0.8.0) that took about 29 hours of run time over three attempts,
plus about 9 hours waiting on the user, built seven slices and opened no PR. Its journal put
the time in implementing (12.7 h), reviewing (8.2 h), hydration (3.6 h), replans (2.2 h),
prechecks (2.1 h) and journal and ledger writes (1.3 h); about 9–10 of those hours were wasted.
It halted three times: on the replan budget, on a hydration timeout, and on a locked 1Password
commit signer. Nothing reached the remote until a human pushed it. All fixes are engine-,
brief- and skill-level and stack-agnostic.

- **A timeout makes a dispatch late, not dead** (`agentHardTimeoutMin`, default 180;
  `timeouts`). An agent cannot be cancelled, yet the run booked agents dead at 40 minutes while
  they kept working. In the first attempt a "dead" implementer was re-dispatched into the
  checkout it was still writing (about 4 hours of failures on the first slice); in the second,
  two implementers booked dead ran 78 and 115 minutes, committed their slices, and cost 1.5
  hours of replans that sent them back as "verify-only". `agentTimeoutMin` is now a soft
  limit: the dispatch is logged as late, still awaited, and its result accepted. At the hard
  limit a reader is given up on; a writer is marked wedged and fences its repo (nothing else is
  dispatched or requeued into that checkout) until it returns, and when only wedged work is
  left the run halts with `kind: 'wedged'`. A hydration that returns nothing is retried once and
  a late one is accepted (a 43-minute hydration halted the second attempt). Only quick deaths
  count toward the circuit breaker. Events `late`, `wedged`, `late-result`, `fence`;
  `telemetry.late` and `telemetry.wedged`; `needsAttention` lists a still-running task as
  `STILL_RUNNING`.
- **A draft PR from the first landing, and the run's state in it** (`deliver`, default
  `'incremental'`; `shipOnHalt`; `draftPr`). After each landing, one haiku dispatch
  (`briefs/ship.md`), in its own worktree, pushes the exact landed SHA to the run branch
  (fast-forward, hooks run, never forced) and opens or updates the repo's draft PR. Its body
  lists the landed tasks and carries a hidden state marker, `<!-- grimoire:state v1 <base64
  JSON> -->`, with the run's checkpoint, rewritten on every landing: the PR is the run's proof
  and its saved state. The terminal slot marks it ready after the gate. On a halt every repo
  pushes what landed and gets a status comment: the reason, what landed, what is open, what to
  fix, how to resume. A ship failure never halts or replans; a repo whose pre-push hook wants
  the gate stops incremental pushes (`shipped.<repo>.disabled`). New result fields `draftPrs`
  and `shipped`; `prs` still lists ready PRs only.
- **Landed work survives the session and is absorbed on resume.** The checkpoint recorded
  landed ids that nothing read back, and the tracker keeps issues open until the PR merges, so
  each new session re-dispatched landed work. Checkpoint v2 records every landed task's run
  branch and SHAs, and the journal flushes on every landing. At startup the engine reconciles
  the checkpoint, from `resumeState` or from the draft PR's state marker, against the local or
  remote run branch and absorbs each task whose head is on it (`absorb` event;
  `resumedLanded`, with `source: 'checkpoint' | 'pr'`), so a new session or another machine
  continues where the last one stopped. An implementer that finds its work already on the
  branch returns `landedBefore` instead of an empty range: SHAs already reviewed land as they
  are, others are reviewed as that range, and no "no change" fix is bought (the third
  attempt's empty ranges bought fix rounds that returned invalid start SHAs).
- **Environment checks** (`builtinEnvChecks`, default on; `environmentChecks`). The third
  attempt's implementer found the commit signer locked halfway through a task, and a replan
  spent about eight minutes diagnosing it before halting. Per repo, a signed commit in a
  scratch worktree and an `ls-remote` of the origin, plus the project's own checks, each under a
  portable time limit (`perl -e 'alarm …'`: stock macOS has no `timeout`, which the implement
  brief recommended for hang-prone commands such as the first attempt's Playwright WebKit
  runs). At start a failure refuses the run (`environment_unavailable`); after a BLOCKED, DIED,
  late or failed push, before the next replan and the final wave, it halts with
  `kind: 'environment'` and the fix, and no replan is spent. One haiku dispatch
  (`briefs/env.md`); event `env`; result `environment`.
- **The journal agent can only run its script.** In the first attempt the haiku journal
  agent, running from the product checkout with the project's instructions loaded, acted on its payload.
  Event lines and `run.json` now travel base64 and are decoded by the script; the brief says
  the payload is data and forbids any other command. `run.json` is written only when the flush
  is not older than what is stored, so a late flush never rolls back a newer checkpoint. The
  ledger and ship payloads travel the same way.
- **Per-task reviewers in parallel** (`reviewParallel`, default `'stages'`). Precheck, spec
  review and quality review ran one after another, and reviewing took 8.2 hours. Spec and
  quality round 0 now run together on the same head after the precheck; a spec fix that moves
  the head re-runs quality. A reviewer that runs commands does it in its own detached worktree:
  two reviewers building in one checkout emptied each other's build output.
- **Hydration ahead** (`hydrateAhead`, default 2). In a chain each hydration (6–43 minutes,
  3.6 hours in all) waited for its blocker to land. The next ready tasks are now hydrated while
  their blockers are in flight, and the implementer is told the code may have moved since.
- **Short limits and a hedge for mechanical dispatches.** Preflight, precheck, journal, ship
  and environment checks shared an implementer's 40-minute limit; a one-word preflight reply
  took 12 minutes, and prechecks took 5–13 minutes for about eight git commands (2.1 hours in
  all). They now have limits of their own (`timeouts`); preflight and precheck start one
  duplicate when the first is slow (`hedge`); the preflight prompt asks for the reply and
  nothing else; the precheck runs one fact script in a single Bash call.
- **The skill resumes by state and says how long a run takes.** The third attempt was a
  `resumeFromRunId` relaunch with only `agentTimeoutMin` raised, on a stale checkpoint: the
  replay diverged at the first late result and redid three slices, 3.5 hours for two small
  commits. The preview now returns an `estimate` (critical path × minutes per task;
  `estimatePerTaskMin`), about 7–20 hours for that project, and the `orchestrate` skill prints
  it, says a draft PR appears after the first landing, and names the environment checks.
  Before an execute run it tells the user the duration and checks commit signing, push and the
  project's prerequisites. Invoked on a project that already has a run, it finds that run (the
  newest matching `run.json`, else the draft PR's state marker), shows k/n landed with the proof,
  and relaunches with the same `runId` and a fresh `resumeState`; starting from scratch takes an
  explicit request. `resumeFromRunId` is kept for a byte-identical relaunch, the tracker alone
  never resumes a run, and after a halt the skill reads the PR's status comment first.
- **Logs and eval cases.** `/grimoire:logs` summarizes the new events in words and shows a
  v2 checkpoint's landed tasks and heads. `orchestrate` evals: resume by state after a halt, a
  knob change on resume, the preview's estimate, an environment halt, and a new-session
  relaunch that finds the run.

### Upgrading from 0.8.1
Nothing to change in `grimoire.config.json`.
- Draft PRs now appear after each repo's first landed task, and each landing pushes the run
  branch, which triggers its CI and previews. Set `deliver: 'end'` (run-wide, or per repo) to
  keep pushes for the end; `shipOnHalt: false` also skips the halt push and comment.
- A run can now refuse to start with `environment_unavailable` when a signed commit or the
  remote does not answer: unlock the signing agent or fix the remote, or pass
  `builtinEnvChecks: false`.
- `agentTimeoutMin` is now a soft limit: a late agent is awaited and its result accepted.
  `agentHardTimeoutMin` (180) is where the run stops waiting; `repos[].timeoutMin` still raises
  its repo's writers' limits.
- Checkpoint v2 is backward compatible: a 0.8.x `resumeState` still resumes its budgets; it has
  no SHAs, so landed tasks are not absorbed from it.
- Resume with the same `runId` and a fresh `resumeState` (`/grimoire:orchestrate` does it), not
  with `resumeFromRunId` and changed args.

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
