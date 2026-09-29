# Changelog

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
  so a merge task is no longer blamed for every lane merged before it. A footprint-only
  precheck failure that repeats with no new commit becomes an advisory note and the panel runs.
- **Agent preflight** (`preflight`, default on). Before any hydration or implementer, every
  agent type the run can dispatch answers one trivial haiku prompt; any that returns nothing
  refuses the run as `agents_unavailable`, naming the types.
- **Dead reviewers are a harness failure.** When every reviewer of a stage returns nothing,
  the round is retried once, then the run halts as `reviewers unavailable`
  (`REVIEWERS_UNAVAILABLE`): no replan spent, no code marked failed.
- **Escalation only for code failures.** A replanned task moves to opus only when its last
  failure was code-kind; harness failures (dead agent, merge conflict, footprint or ancestry
  precheck, reviewers unavailable) keep the selector's tier. The replanner is told which
  failures were harness failures.
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
  and `run.json` carry `attempt`, the session number under a `runId`; from attempt 2 chunks
  are `<firstSeq>.a<N>.jsonl`, so a relaunch never overwrites an earlier attempt, and
  `render-logs` dedupes by (attempt, seq).
