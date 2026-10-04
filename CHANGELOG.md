# Changelog

## 0.9.0 — run durability

Fixes found in a real unattended run on 0.8.0: one static-site repo, ten issues in a strict
blocked-by chain, `maxPerRepo` 1. It ran about 29 hours (29.4 h of wall clock over three
attempts, plus about 9 hours waiting on the user), built seven slices and opened no PR. Its
agents' time, which overlaps wherever dispatches ran side by side, went to implementing
(12.7 h), reviewing (8.2 h), hydration (3.6 h), replans (2.2 h), prechecks (2.1 h) and journal
and ledger writes (1.3 h). About 16.6 of the 29 hours were a third-party PreToolUse Bash hook
timing out at 30 s on every call: 0.8.1's session probe (`maxToolLatencySec`) refuses such a
session, but the installed plugin was 0.8.0. About 9–10 hours were wasted on the failures
below. The run halted three times: on the replan budget, on a hydration timeout, and on a
locked 1Password commit signer; the Mac also hibernated on battery mid-run. Nothing reached the
remote until a human pushed it. All fixes are engine-, brief- and skill-level and
stack-agnostic.

- **A timeout makes a dispatch late, not dead** (`agentHardTimeoutMin`, default 180;
  `timeouts`). An agent cannot be cancelled, yet the run booked agents dead at 40 minutes while
  they kept working. In the first attempt a "dead" implementer was re-dispatched into the
  checkout it was still writing (about 4 hours of failures on the first slice); in the second,
  two implementers booked dead ran 78 and 115 minutes in all, committed their slices, and cost
  1.5 hours of replans that sent them back as "verify-only". `agentTimeoutMin` is now a soft
  limit: the dispatch is logged as late, still awaited, and its result accepted. At the hard
  limit a reader is given up on; a writer is marked wedged and fences its repo (nothing else is
  dispatched or requeued into that checkout) until it returns, and when only wedged work is
  left the run halts with `kind: 'wedged'`. A lane whose review passed while its repo was
  fenced settles `FENCED`, its worktree kept for the retry. A hydration that returns nothing is
  retried once and a late one is accepted (a 43-minute hydration halted the second attempt).
  Only quick deaths count toward the circuit breaker. Events `late`, `wedged`, `late-result`,
  `fence`; `telemetry.late` (each outcome `accepted`, `died`, `abandoned`, `wedged` or
  `pending`) and `telemetry.wedged`; `needsAttention` lists a still-running task as
  `STILL_RUNNING`.
- **A draft PR from the first landing, and the run's state in it** (`deliver`, default
  `'incremental'`; `shipOnHalt`; `draftPr`). After each landing, one haiku dispatch
  (`briefs/ship.md`), in its own worktree, pushes the exact landed SHA to the run branch
  (fast-forward, hooks run, never forced) and opens or updates the repo's draft PR with `gh`.
  Its body is the run's proof (each landed task with its title, head SHA and "passed spec and
  quality review", what is still open, and the exact resume instruction) and ends with a hidden
  state marker, `<!-- grimoire:state v1 <base64 JSON> -->`, rewritten on every landing: per
  repo, the run's counters and each landed task's id, head and first commit, at most 40 tasks
  and 8,000 characters, with no learnings or summaries. The terminal slot waits for the repo's
  pending ship, then the gate marks the PR ready and keeps the marker. On a halt (also a wedged
  one: only the last reviewed head is pushed) every repo pushes what landed, gets its draft PR
  if it has none, and gets a status comment: the reason, what to fix first, what landed, what is
  open, any agent still running, how to resume; a repo whose terminal slot is still running is
  left to that slot. A ship failure never halts or replans: two failed pushes in a row, or a
  pre-push hook that wants the gate, stop that repo's incremental pushes
  (`shipped.<repo>.disabled`), and a failed push asks for an environment check. New result
  fields `draftPrs` and `shipped`, event `ship`; `prs` still lists ready PRs only.
- **Landed work survives the session and is absorbed on resume.** The checkpoint recorded
  landed ids that nothing read back, and the tracker keeps issues open until the PR merges, so
  each new session re-dispatched landed work. Checkpoint v2 records every landed task's run
  branch, head and first commit, and the journal flushes on every landing. At startup the index
  reconciles what `resumeState` and the draft PRs' markers list against the run branch, and the
  engine absorbs a task only when its head (and its first commit) is on the run branch and not in
  the base (`absorb` event; `resumedLanded`, with `source: 'checkpoint' | 'pr'`), so a new
  session or another machine continues where the last one stopped. Reviewed SHAs are now per
  task and per run branch: one task can no longer cite another's reviewed head and land
  unreviewed. An implementer that finds its work already on the branch returns `landedBefore`
  instead of an empty range: SHAs reviewed for that task land as they are, others are reviewed
  as that range, and no "no change" fix is bought (the third attempt's empty ranges bought fix
  rounds that returned invalid start SHAs).
- **A preview proves the resume before it runs.** The preview's reconcile runs read-only and
  returns `resumedLanded`, `unverifiedLanded` (listed as landed, not verified: built again),
  `stillToBuild` and `branches` (each repo's run branch, sync state, PRs and marker verdict),
  with one line, `◎ resume: <k>/<n> landed, verified on <run branch> @ <sha> — still to build:
  <ids>`. Its `estimate` counts only the work still to build.
- **A PR state marker is trusted only as far as it is verified.** Anyone who can edit a PR body
  can write a marker, and a review showed a planted one could put learnings into prompts, get
  foreign ids or an ancestor head absorbed, and halt a run at start with
  `outputTokensSpent: 5e9`. Now the index agent's copy must match the length and `cksum` the
  script printed; the marker must name the same project (by key, unless the run branch is set
  explicitly), repo and run branch; only PRs from the same repository are read, never a fork's;
  only ids of this project's index are absorbed, and only with heads outside the base; the
  counters are clamped; and no marker text reaches a prompt (learnings come from the local
  checkpoint only).
- **The reconcile runs under bash, zsh and dash, within 90 seconds.** The Bash tool runs the
  user's shell, and in zsh `"$3:refs"` is `$3` with the `:r` modifier: on a fresh clone the run
  branch was never fetched and every landed task ran again. The script is POSIX sh with every
  risky parameter braced, checks repos in parallel with a 30-second limit on each fetch and `gh`
  call and one 90-second deadline (sequential limits once took 181 s against the Bash tool's
  120), and prints `fetch=`, `inBase=`, `ahead=` and `WARN` lines the engine logs.
- **A run branch the run cannot build on refuses the launch.** For a repo with work left, a
  local run branch that diverged from origin refuses as `run_branch_diverged`; one behind origin
  that could not be fast-forwarded (uncommitted changes, or checked out in another worktree), or
  only on origin and not created, refuses as `run_branch_behind`. `problems` says what to run;
  the run never resets a branch. A failed fetch is a warning, and every sync state is logged:
  a silent `behind` or `missing` had looked like a fresh run.
- **Starting over is explicit** (`freshStart: true`): `resumeState` and every PR marker are
  ignored, nothing is absorbed, the budgets start at zero, and no branch is moved. Since its
  first push could not fast-forward an earlier run's branch, it refuses as `run_branch_exists`
  when origin holds the run branch with commits not in the base: pass a new `runBranch`, or
  remove the old branch and PR. Without it, a relaunch always resumes.
- **Environment checks** (`builtinEnvChecks`, default on; `environmentChecks`). The third
  attempt's implementer found the commit signer locked halfway through a task, and a replan
  spent about eight minutes diagnosing it before halting. Per repo, a signed commit in a scratch
  worktree and an `ls-remote` of the origin, plus the project's own checks, each under a
  portable time limit (`perl -e 'alarm …'`: stock macOS has no `timeout`, which the implement
  brief recommended for hang-prone commands such as the first attempt's Playwright WebKit
  runs). At start a failure refuses the run (`environment_unavailable`); after a BLOCKED, DIED,
  ERROR or FENCED task, a late writer, or a failed push, a check runs in flight (a failure stops
  new dispatches at once) and before the next replan and the final wave; a failure halts with
  `kind: 'environment'` and the fix, and no replan is spent. On macOS a `power` check warns when
  the machine runs on battery (the Mac hibernated on battery at 1% and the run lost 49 minutes);
  it never refuses. One haiku dispatch (`briefs/env.md`); event `env`; result `environment`.
- **Replans are charged to the code only.** In the first attempt, two of the three replans
  answered agents booked dead at the time limit while they worked, and a browser engine that
  hung on that Mac; the run then halted on its exhausted budget. The replanner now names a
  `cause`: `code` spends a replan, `harness` (a dead or late agent, a lane that would not merge)
  is free up to `maxReplans` times and then charged, and `environment` halts the run with
  `kind: 'environment'` without requeuing anything. A HALT on a harness cause carries
  `kind: 'harness'`; the halt `kind` is in the `halt` event and in `run.json`'s `summary.halt`.
- **A run branch named after the project's key** (`runBranch` overrides it, also per repo). The
  run's project text was a sentence ("acme/site#3 — GitHub parent issue #3; its slices are
  …"), so its branch was that sentence slugged and cut at 60 characters, and a relaunch worded
  differently would have built on another branch and missed its PR and saved state. The branch
  now takes the first ticket reference in the project text (`owner/repo#N`, `#N`, a key like
  `PROJ-123`, or a tracker URL's id), so that sentence and `acme/site#3` share
  `feat/acme-site-3-<repo>`; a project text with no reference is slugged as before.
- **Shell guidance for implementers and reviewers.** `cd` replaced by a shell plugin's function
  made 147 commands of the run fail: the briefs now say never `cd` (use `git -C` and absolute
  paths, or `builtin cd`), read files with the Read and Grep tools, and bound hang-prone
  commands with `perl -e 'alarm …'`, or `timeout` or `gtimeout` where they exist. The engine's
  own scripts use `builtin cd`, and the guard hook follows `builtin cd` and `command cd` like
  `cd`.
- **The journal agent can only run its script.** In the first attempt the haiku journal agent,
  running from the product checkout with the project's instructions loaded, acted on its
  payload. Event lines, `run.json` and the landed-task detail now travel base64 and are decoded
  by the script; the brief says the payload is data and forbids any other command. The ledger
  and ship payloads travel the same way.
- **State writes that cannot corrupt, roll back or overflow.** 0.8.x wrote `run.json` through
  one shared temp file, with no lock and no order: two flushes at once could corrupt it, and a
  late flush could roll the checkpoint back. Every decoded payload is now checked against the
  engine's byte count and `cksum` before anything is written (`RUNJSON ok|kept|bad`,
  `LANDED ok|bad`, `LEDGER bad`; a refused `run.json` counts in
  `telemetry.journal.runJsonLost`); writers take a lock (`<runId>/.lock`); `run.json` moves into
  place atomically and only when it is not older than the one on disk, ordered by the resume
  generation and `lastSeq`; and each launch registers one attempt for its session token in
  `<runId>/sessions` (two launches that start from exactly the same state share one). Since
  `run.json` travels in every flush, it keeps only what a resume needs (with every task's detail
  in it, a 40-task run sent 89 KB per flush, enough to outrun the writer), and each task's
  detail goes once to `<runId>/landed.jsonl`.
- **Per-task reviewers in parallel** (`reviewParallel`, default `'stages'`). Precheck, spec
  review and quality review ran one after another, and reviewing took 8.2 hours of agent time.
  Spec and quality round 0 now run together on the same head after the precheck; a spec fix that
  moves the head re-runs quality. A reviewer, verifier or guard that runs commands does it in
  its own detached worktree: two reviewers building in one checkout emptied each other's build
  output.
- **Hydration ahead** (`hydrateAhead`, default 2). In a chain each hydration (6–43 minutes,
  3.6 hours in all) waited for its blocker to land. The next ready tasks are now hydrated while
  their blockers are in flight, and the implementer is told the code may have moved since.
- **Short limits and a hedge for mechanical dispatches.** Preflight, precheck, journal, ship
  and environment checks shared an implementer's 40-minute limit; a one-word preflight reply
  took 12 minutes, and prechecks took 5–13 minutes for about eight git commands (2.1 hours in
  all). They now have limits of their own (`timeouts`); preflight and precheck start one
  duplicate when the first is slow (`hedge`; `hedgeAfter` applies only to them and to hydration
  without claims); the preflight prompt asks for the reply and nothing else; the precheck runs
  one fact script in a single Bash call.
- **The skill resumes by state and says how long a run takes.** The third attempt was a
  `resumeFromRunId` relaunch with only `agentTimeoutMin` raised, on a stale checkpoint: the
  replay diverged at the first late result and redid three slices, 3.5 hours for two small
  commits. The preview now returns an `estimate` (critical path × minutes per task;
  `estimatePerTaskMin`), about 7–20 hours for that project, and the `orchestrate` skill prints
  it, says a draft PR appears after the first landing, and names the environment checks.
  Before an execute run it tells the user the duration, checks commit signing, push and the
  project's prerequisites, and warns that a message sent to the session while the run goes is
  relayed into its agents' prompts (in the real run a haiku probe then ran the build and the
  gate): instructions go in after the run, or the run is stopped first. Invoked on a project
  that already has a run, it finds the newest local `run.json`, passes its `runId` and a fresh
  `resumeState` to the preview and shows its resume line, then relaunches by state; the engine
  reads the draft PRs' markers itself. Starting from scratch takes an explicit request and
  `freshStart`. `resumeFromRunId` is kept for a byte-identical relaunch, the tracker alone never
  resumes a run, and after a halt the skill reads the PR's status comment first.
- **Late results land where they belong.** An adversarial review raced the engine's
  asynchronous paths against each other. A final wave no longer hangs when one slot wedges and
  another then returns. A wedged terminal slot is booked when it returns, even after the run
  has ended, and its gate is never run twice (a second push, a second PR); ship on halt leaves
  that repo to it. A prefetch that lands after a replan never replaces the task the replan
  revised. A writer that returns after the run stopped dispatching flows no further. A repo with
  a failed task is never gated, its PR never marked ready, while that failure stands; when the
  budget runs out with nothing else left, the halt names each task that did not land and its
  repo. A dead journal writer stops being queued instead of holding the end of the run for
  8 minutes per chunk (its chunks count in `telemetry.journal.lostEvents`). A prefetch's claims
  are handed back when the run halts before it returns.
- **Logs and eval cases.** `/grimoire:logs` summarizes the new events in words (each `absorb`
  source, `harness-routed`), shows a halt's kind and a v2 checkpoint's landed tasks and heads,
  joins `landed.jsonl`, and counts discarded review rounds apart. `orchestrate` evals: resume by
  state after a halt, a knob change on resume, the preview's estimate, an environment halt, a
  new-session relaunch that finds the run, a message sent during a run, and starting over.

### Upgrading from 0.8.1
Nothing to change in `grimoire.config.json`.
- Update the installed plugin (`/plugin update grimoire@grimoire`) before the next run. The run
  behind this release ran 0.8.0 and so never had 0.8.1's session probe, which would have
  refused the hook that cost it about 16.6 hours.
- Draft PRs now appear after each repo's first landed task, and each landing pushes the run
  branch, which triggers its CI and previews. Set `deliver: 'end'` (run-wide, or per repo) to
  keep pushes for the end; `shipOnHalt: false` also skips the halt push and comment. The draft
  PR and its state marker go through `gh`: without it, pushes go on and the resume relies on the
  local `run.json`.
- A run can now refuse to start with `environment_unavailable` when a signed commit or the
  remote does not answer: unlock the signing agent or fix the remote, or pass
  `builtinEnvChecks: false`. It also refuses a run branch it cannot build on:
  `run_branch_diverged` or `run_branch_behind` (fix the branch as `problems` says, then
  relaunch), and, with `freshStart`, `run_branch_exists`.
- The run branch is now named after the project's first ticket reference. A run started on
  0.8.x whose project text held more than its key (a sentence) used another branch name: to
  continue it, pass `runBranch` with that name.
- `agentTimeoutMin` is now a soft limit: a late agent is awaited and its result accepted.
  `agentHardTimeoutMin` (180) is where the run stops waiting; `repos[].timeoutMin` still raises
  its repo's writers' limits.
- `maxReplans` now counts only replans whose cause is the code: a harness cause is free up to
  `maxReplans` times, then charged, and an environment cause halts the run instead of
  replanning. `replans` in the result counts the charged ones.
- Checkpoint v2 and the slimmer `run.json` are backward compatible: a 0.8.x `resumeState` still
  resumes its budgets (replans, fix rounds, spend, sequence), but it has no SHAs, so nothing is
  absorbed from it; each landed task runs again, finds its work on the run branch and is
  reviewed as it stands rather than rebuilt.
- Resume with the same `runId` and a fresh `resumeState` (`/grimoire:orchestrate` does it), not
  with `resumeFromRunId` and changed args. To start over on purpose, pass `freshStart: true`.

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
