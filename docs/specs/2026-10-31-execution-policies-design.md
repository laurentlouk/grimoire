# Execution policies: design

**Status:** approved 2026-11-01, as written, with the five recommended answers; slices 1–5 shipped in 0.16.0 ([#59](https://github.com/laurentlouk/grimoire/pull/59)) and 0.17.0 ([#60](https://github.com/laurentlouk/grimoire/pull/60)), slice 6 open · **Date:** 2026-10-31 · **Targets:** `origin/main` at 0.15.1 (`5d9dcc1`) · **Input:** the "Adaptive Hybrid Orchestration" brief (FAST / BALANCED / STRICT)

## Summary

The brief asks for a hybrid. Low-risk tasks would run in native Claude Code sessions with a one-shot quality gate, and high-risk tasks would keep the dynamic workflow. The aim is to cut time, tokens and verification loops without lowering quality.

This design keeps the goal and changes the means. **Policies yes, a second execution engine no.**

- **No separate native-session lane inside a run.** Every `agent()` call in the workflow is already a native Claude Code subagent. No documented primitive lets a workflow start, steer or hear back from a fuller session (verified below). The routes that exist (`claude --bg`, `claude -p`, agent teams, the desktop app's `start_session`) are either excluded by the owner's rule or cannot run unattended and resumably inside a run.
- **FAST, BALANCED and STRICT become task-level execution policies in the engine that already exists.** That engine already has the DAG, lanes, worktrees, journal, resume and replanner. A policy is a profile over knobs that exist today: the per-task panel, fix budget, guard, escalation and tier floor. The personas, verdict schema, severity gate and failure kinds stay the same for every policy.
- **Native sessions stay where they already work:** at the edge, one session per tracker project or loose issue, launched by `/grimoire:manager`. Those sessions run `implement` → `review`, and `review` reads the same policy table as the loop.

The measured baseline changes what can be promised. Repeated review loops are rare and cheap on recorded runs: 8 % of first review rounds gate, and guard plus verify cost under 1 %. FAST's saving is therefore modest per task: roughly the review and precheck share it skips, plus the fix-round tail it caps. The large costs are the implementer (≈ 63 %) and the run's fixed per-task overhead (≈ 20 %). The token-economy plan already targets them. Policies are still worth shipping, for three reasons:
- they make the risk contract of each task explicit and configurable;
- they add per-task specialist lenses to high-risk tasks, a quality gain the current engine lacks;
- they give tier routing the history signal it needs.

## 1 · What exists: the reusable map

Everything below is on `origin/main`. Line numbers are at `5d9dcc1`. *This checkout (`fix/loop-integrity-0.8.0`) is 296 commits behind main and was not used for the analysis.*

| Concern | Existing mechanism | Where | Reused as |
|---|---|---|---|
| Task classification | Hydration doubles as the **selector**: `agent` × `model` + `routeReason` per task, from a written rubric | `briefs/hydrate.md` "Route each task"; `routeTask` `orchestrate-loop.js:5661` | the place `policy` is proposed (no extra dispatch) |
| Routing validation | the engine accepts only the owner or an enabled specialist; unknown → owner, counted as a fallback | `routeTask` | same pattern validates `policy` against hard floors |
| Tier escalation | opus from `escalateAtFixRound`, and for a task replanned after a **code** failure | `modelFor` `:4483`, `routeTask` | STRICT's opus floor; FAST → STRICT escalation |
| Dependency management | continuous `dependsOn` dispatch, no wave barrier, critical-path bias (`downstreamOf` `:5630`), `landed()` gating | scheduler loop after `:5850` | unchanged; a FAST task lands only by passing |
| Isolation | declared-`files` worktree lanes, at most `maxPerRepo` per repo, serialized integrate, ship lock | `startTask` `:5695`, `integrateLane` | unchanged for every policy |
| Reviews | `REVIEW_PANEL` (structure) + `personas/*.md` (lenses), split by stage: `spec` / `quality` per task, `terminal` per repo | `:193`, `panelFor` `:2356` | the **single** quality definition every policy draws from |
| Severity gate | blocker/major gate, minor/nit advisory; a FAIL with no finding becomes a synthesized major | `runReviewStage` `:4308`, `isGating` | identical in every policy |
| False-positive filter | sonnet verifier before any fix is bought | `verifyFindings` | identical |
| Post-fix check | binary sonnet guard on the fix's own diff: PASS, or RE_REVIEW by the full panel | `runReviewStage`, `briefs/guard.md` | FAST's one-shot post-fix check |
| Structural check | haiku precheck, one fact script | `runTask` `:4584`, `briefs/precheck.md` | identical |
| Retries / adaptation | resolve rung (scouts by question shape), fix rung, replan rung at quiescence, harness vs code failure kinds | `dispatchImpl` `:4496`, `failureKind` `:2506`, `settle` `:5715` | FAST skips the replan rung for its own attempt and escalates instead |
| Project-level quality | terminal sweep per repo over the integrated branch, then the gate, once | `terminalSlot` `:5850` | the **backstop that makes FAST safe**: unchanged |
| History | run ledgers, `learnings` `{text, repos}`, the journal, `crystallize` tuning the rubric | ledger/crystallize briefs, `relevantLearnings` `:171` | the history routing signal |
| Telemetry / cost | decision journal (`route`, `review`, `fix`, `guard`, …); cache-aware cost per dispatch, task, tier, lens and repo | `emit` `:2625`, `scripts/render-logs.mjs`, `scripts/economy/` | the benchmark instrument, extended with `byPolicy` |
| Resume | `runId` + `resumeState` checkpoint (fix rounds, replans, landed tasks), PR state markers | `checkpointTaskRecord` `:5108` | persists each task's policy and escalation |
| Stubbed runtime tests | the whole control flow runs in ms against scripted `agent()` stubs | `workflows/tests/support/script-harness.mjs` | every Phase 6 scenario |
| Native sessions (edge) | `manager.mjs` routes ticked issues deterministically (`routeOf`: `roast` / `orchestrate` / `implement`) and launches one desktop session per group, with checkout serialization (`waitsFor`) | `scripts/manager.mjs:1938`, `:1991`; `skills/manager` §6 | where FAST runs *outside* the loop |
| Session review policy | `implement` + `review` skills; the owner's standing rule "one review per issue" (one combined reviewer, one fix for blocker/major, no re-review, tests, PR) | `skills/review/SKILL.md`; auto-memory | becomes the FAST profile, read from the shared table |

## 2 · Claude Code: what is verified, and what is not

Fetched from the official docs on 2026-10-31.

| Primitive | Verified facts | Fit |
|---|---|---|
| **Workflow `agent()`** | "agent() spawns one subagent"; schema output, retried; per-call `model`, `effort`, `agentType`, `isolation: 'worktree'`; at most 16 concurrent agents (`CLAUDE_CODE_WORKFLOW_MAX_CONCURRENT_AGENTS`); 1,000 agents per run; nested `workflow()` one level deep; no filesystem/shell, no clock; **no cancel handle**. [workflows](https://code.claude.com/docs/en/workflows.md), `workflows/README.md` "Runtime constraints" | **this is the native child session**; already used for every dispatch |
| **Subagents (Agent tool)** | frontmatter `model`, `effort`, `tools` / `disallowedTools`, `isolation: worktree`, `maxTurns`, `background`, `memory`; background by default; resumable via `SendMessage` with full history; nesting up to 3 levels; 20 concurrent by default; worktrees branch from the default branch unless `worktree.baseRef: head`, removed when unchanged. [sub-agents](https://code.claude.com/docs/en/sub-agents.md), [worktrees](https://code.claude.com/docs/en/worktrees.md) | what `implement` / `review` use in a session |
| **Agent teams** | experimental (`CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`), interactive only, not under `-p`; shared task list with dependencies; "no session resumption for in-process teammates", "one team per session", "no nested teams"; "significantly more tokens than a single session"; same-file edits overwrite. [agent-teams](https://code.claude.com/docs/en/agent-teams.md) | **rejected**: no resume, no nesting, costlier, interactive only |
| **Background sessions** | `claude --bg "<prompt>"` (research preview), controlled by `claude agents --json`, `attach`, `logs`, `stop`; worktree-isolated by default. [agent-view](https://code.claude.com/docs/en/agent-view.md) | **rejected**: a CLI call (owner's rule D9 of the token-economy spec) outside the run's journal, budget and cancellation |
| **Headless** | `claude -p --output-format json` returns `result`, `session_id`, `usage`, `total_cost_usd`. [headless](https://code.claude.com/docs/en/headless.md) | **rejected**: owner's rule, no `claude -p` |
| **Cross-session messaging** | `ListAgents` / `SendMessage` between sessions, plain text only, version-gated; cloud sessions cannot reply. [cross-session-messaging](https://code.claude.com/docs/en/cross-session-messaging.md) | no structured result; not reachable from a workflow script |
| **Desktop `start_session`** | an app tool (Code tab), used by `/grimoire:manager`; a launched session reports back a ≤ 400-character note | the edge path only; human-visible, not programmatic |
| **Hooks** | `SubagentStart` (context only), `SubagentStop` / `Stop` (can block), `TaskCreated` / `TaskCompleted` / `TeammateIdle` (teams). [hooks](https://code.claude.com/docs/en/hooks.md) | not needed by this design |
| **Telemetry** | per-subagent tokens are not in the Agent tool result; OTel `claude_code.token.usage` / `cost.usage` carry `agent_id` and `workflow.run_id` on events. [monitoring-usage](https://code.claude.com/docs/en/monitoring-usage.md), [costs](https://code.claude.com/docs/en/costs.md) | grimoire already reads cost from transcripts (`scripts/economy/`) |

**Not documented:**
- any way for a workflow or subagent to start or message a separate full session and receive its result;
- the `isolation` option on `agent()` is not on the docs page; the Workflow tool's own reference lists it, and the engine uses it (`orchestrate-loop.js:6669`);
- when subagent worktrees are created.

**Conclusion.** A "native session" with its own lifecycle, driven from inside the engine, is not a verified capability. The cheaper per-task path has to come from **policy**, not from a different substrate.

## 3 · Where the time and tokens go today (measured)

**Corpus:** 15 recorded runs with journals on this machine (odyyy-orchestrator ×13, lab ×1, iDeaLex ×1), read with `render-logs.mjs summary --json` and a journal counter (session scratchpad `baseline.mjs`).

| Measure | Value |
|---|---|
| Tasks dispatched / landed | 113 / 123 settles landed (absorbed included), 16 failed settles |
| Per-task review stages; gating on round 0 | 240; **19 (7.9 %)**. odyyy `firstRoundRate` 0.94 |
| Tasks needing any fix / two or more | 25 (22 %) / **4 (3.5 %)** |
| Review dispatches per task | ≈ 3.4 (386 / 113); prechecks ≈ 1.3; guards 13 and verifies 21 in total |
| Replans; opus escalations | 17; 0 |
| Cost split (odyyy, 727 M effective tokens, 1,550 dispatches) | implement 58 % + fix 5 %; all review lenses ≈ 16 % (break-it 6, spec-hawk 4, data-integrity 2, SRE 2, …); precheck 1 %; guard + verify < 1 %; mechanical (journal 5, hydrate 4, ship 2, gate 2, preflight, env, index, ledger, integrate, seal, harness-context) ≈ 20 % |
| Tier share of cost | opus 59 %, sonnet 29 %, haiku 12 % (lab: 48 / 41 / 11) |
| Late dispatches | 18 % (odyyy `lateShare`); median active run 149 min |

**What this means for the brief:**
- "Unnecessary verification loops" are not a material cost on these runs. The guard already stops most panel re-runs.
- A FAST profile saves, per low-risk task, roughly one to two of its ≈ 3.4 review dispatches, the precheck when it is skipped, and the rare fix-round tail. Order of magnitude: **10–20 % of that task's cost, a few minutes of its critical path.** The benchmark (§8) measures the real figure.
- The large levers are elsewhere:
  - implementer behaviour: the token-economy loop guard, slices 3–4;
  - tier choice: hydration's "unsure → take the higher" rule plus no history signal leave opus at 59 %;
  - the per-task mechanical overhead: a non-goal of the token-economy spec, left to its own roast.
- This design feeds the tier lever (D6) and leaves the other two to their own plans.

**Caveats:**
- One owner's projects, mostly one product.
- The economy report attributes dispatches by label, and some labels are ambiguous (#56).
- Effective tokens are tier-blind: a cheaper tier shows up in dollars (`scripts/economy/pricing.mjs`), not in effective tokens.

## 4 · Proposed architecture

```
           hydrate (selector) ──► routeTask ──► policy = resolve(floor, proposal, override, history)
                                                   │
                     ┌──────────────── one scheduler · one DAG · one journal · same lanes ─────────────┐
                     ▼                              ▼                                                ▼
   FAST ──────────────────────────  BALANCED (= today) ───────────────────  STRICT ──────────────────────────
   impl → precheck                  impl → precheck                          impl (opus floor) → precheck
   → spec ∥ break-it, round 0       → spec ∥ quality core, round 0           → spec ∥ core + promoted risk lenses
   → verify → ONE consolidated fix  → verify → fix ≤ maxFixAttempts / stage  → verify → fix ≤ maxFixAttempts / stage
   → guard once (+ repo `check`)    → guard ⇄ panel re-review                → guard ⇄ panel re-review
   PASS → land                      PASS → land · FAIL → replanner           PASS → land · FAIL → replanner
   FAIL → escalate to STRICT on the SAME head (commits kept, no re-implementation)
                     └──────────────────────────────┬─────────────────────────────────────────────────┘
                                 per repo, at drain: terminal sweep → gate → PR (unchanged)
```

**Edge (outside a run).** `/grimoire:manager` already sends a loose ready issue to a new session (`implement`, then `review`). That session applies the FAST profile from the same table by default, and BALANCED or STRICT when the issue's signals call for it. The decision is the same deterministic function, run by the session against the same config.

### Decisions

**D1. A policy is a profile, not a lane.**
- `policy ∈ {fast, balanced, strict}` is a field on the hydrated task.
- The engine reads it at four points:
  - the per-task panel (`panelFor`);
  - the fix budget and consolidation (`runReviewStage`);
  - the tier floor (`modelFor`);
  - failure handling (`settle`).
- Scheduling, lanes, integration, ship, journal and resume do not branch on it.
- **Rejected:** a native-session executor beside `agent()`. It is unverified (§2), and it would duplicate the scheduler, isolation, telemetry and resume.

**D2. BALANCED is today's per-task lifecycle, bit for bit, and the default.**
- Without `policy` in `args`, every task is `balanced` and the run is identical to 0.15.1. The tests assert this with the existing suites unchanged.
- `policy: 'auto'` is opt-in until the benchmark (§8) says otherwise.
- *This departs from the brief's naming on purpose.* The brief maps "existing workflow" to STRICT. Here the existing per-task flow is BALANCED, and STRICT is a superset of it. That way, no default run loses a guarantee, and high-risk tasks gain lenses.

**D3. FAST: one round, one consolidated fix, one post-fix check, escalate on failure.**
- Implement, then precheck. It is kept: at 1 % of cost it is the cheapest stop for an empty or stray diff before any reviewer is paid.
- Then spec-hawk ∥ break-it, round 0, through the same personas and the same `VERDICT_SCHEMA`. data-integrity is not drawn per task. The terminal sweep still covers the repo.
- Verify, then **one** fix dispatch carrying the gating findings of **both** stages. This removes today's path where a spec fix moves HEAD, discards quality round 0, and re-runs it.
- Then the guard, once. FAST's guard brief adds the repo's optional `check` command (new `repos[].check`, e.g. `npm test -- --changed`), run in the guard's detached worktree.
- **PASS** lands.
- **RE_REVIEW, FAIL, a dead guard or a failing `check`** ends the FAST attempt as a visible `fast.fail` event. The task **escalates to STRICT on the same head**:
  - the STRICT panel judges the whole task range (`startSha..head`);
  - the fix round already spent counts against STRICT's budget;
  - nothing is re-implemented.
- No replan is spent on a FAST failure, and dependents wait as for any unlanded task.
- `policies.fast.onFail: 'escalate' | 'fail'`; `'fail'` books the task `QUALITY_FAILED` / `SPEC_FAILED` and leaves it to the replanner.
- *Departure from the brief:* "report PASS or FAIL" holds for the FAST attempt (it is journaled and summarized), but the default then continues as STRICT instead of stopping. Veto it below.

**D4. STRICT: today's flow plus risk lenses promoted into the per-task core, and an opus floor.**
- The personas are reused, only their stage changes for this task:
  - `privacy` (hard authorization) joins the per-task core when a task matches auth, session, secret or PII paths;
  - `data-integrity` joins regardless of repo tag for migration or data paths;
  - a contract-shaped task gets one read-only `contract-checker` dispatch next to the core, its findings gated like a reviewer's.
- The implementer tier is at least opus. `verifyFindings` and the guard stay on.
- **Rejected:** new security personas. The existing lenses plus `security-scout` cover it, and a new lens needs its own evals and calibration first.

**D5. Routing is deterministic first.**
- `policy = override ?? max(floor, raise, eligibleFast ? fast : balanced)`.
- **Floor (hard, engine-computed from config and the hydrated task, no model):**
  - declared files matching `policies.strictPaths` (default globs: `**/migrations/**`, `**/auth/**`, `**/payment*/**`, `**/billing/**`, `**/*.proto`, `**/openapi*.{yml,yaml,json}`, `**/schema.graphql`, `.github/workflows/**`, `**/*.tf`);
  - a repo tag in `policies.strictTags` (default `['infra']`);
  - the selector routing to `migration-engineer`;
  - a `dependsOn` on another repo's task, or a match on `finalCheck` contract repos.
  - Any of these makes the task STRICT.
- **Raise (to at least BALANCED):**
  - no declared files (unknown footprint);
  - more than `policies.fastMaxFiles` (default 3) declared files;
  - `downstreamOf(id) ≥ policies.fanOut` (default 3), since dependents inherit it;
  - the selector chose opus (its own rubric reserves opus for cross-module, concurrency, security, contracts, untested code);
  - a replanned task after a code failure;
  - a history hit (D6).
- **FAST-eligible:** docs-only footprints (`policies.docsPaths`), or a declared footprint within limits on haiku or sonnet with no raise.
- **Hydration's role.** Hydration may *propose* a higher policy with a reason, and the engine takes the max. It can never lower the floor. No extra classification call is made.

**D6. History is a raise, never a demotion past the floor.**
- From the run ledgers, the harness-context loader returns, per (repo, policy), the last N runs' FAST escalation rate and escaped-defect count (§8).
- A repo above `policies.historyMaxEscalation` (default 0.25) gets BALANCED instead of FAST for the run, logged once.
- A learning tagged with the repo that names one of the task's files raises that task.
- The same ledger lines carry the selector's tier and the task's first-round outcome. `crystallize` can then propose a calibrated rubric (eval-gated, a human merges): e.g. "sonnet FAST tasks in `webapp` passed first round 18 / 19, so stop defaulting to opus there".
- Nothing is demoted automatically mid-run.

**D7. Manual overrides, with floors that hold.**
- Precedence: tracker label `grimoire:policy/<p>` on the issue (read at hydration) > `repos[].policy` > run `args.policy`.
- `auto | fast | balanced | strict` everywhere.
- An override below a hard floor is **refused** and logged as `policy.override_refused` with the signal, unless `policies.allowBelowFloor: true`. In that case it is honoured and written into the PR body.

**D8. One failure classification.**
- All policies return the same statuses (`SPEC_FAILED`, `QUALITY_FAILED`, `PRECHECK_FAILED`, `REVIEWERS_UNAVAILABLE`, …) and the same `failureKind` (code vs harness).
- A FAST consolidated failure maps to `SPEC_FAILED` if any spec-hawk finding gated, else `QUALITY_FAILED`.
- `policy` and `escalatedFrom` ride on the result, the `settle` event and the ledger. There is no new failure taxonomy.

**D9. Native sessions at the edge share the table.**
- The profiles live in one place, `workflows/policies.md`: a prose table that the loop's constants are drift-checked against, as `REVIEW_PANEL` is with `personas/`.
- `skills/review` applies the profile its issue resolves to. In a session the default is the owner's standing "one review per issue" rule, which becomes FAST instead of a memory entry.
- `manager.mjs`'s launch prompt names the resolved policy, and `waitsFor` also waits on repos with a **running loop** (read from the `runs` source). Today it only serializes groups of one launch.

## 5 · Decision matrix

| | FAST | BALANCED (default; = 0.15.1) | STRICT |
|---|---|---|---|
| **Typical tasks** | docs, copy, styles, an isolated component, a small fix in a tested area | normal features and fixes, API integration | auth, payments, migrations, infra, cross-repo contracts, wide or untested changes |
| **Chosen by** | eligible and no raise | default, or any raise | any hard floor, an override, or a FAST failure |
| **Implementer tier** | selector's (haiku / sonnet expected) | selector's | ≥ opus |
| **Precheck** | yes | yes | yes |
| **Per-task panel** | spec-hawk ∥ break-it | spec-hawk ∥ quality core by tags | core + promoted `privacy` / `data-integrity` + `contract-checker` by signal |
| **Verify findings** | yes | yes | yes |
| **Fix rounds** | 1, consolidated across stages | ≤ `maxFixAttempts` per stage (3) | ≤ `maxFixAttempts` per stage |
| **After a fix** | guard once + repo `check` | guard → panel re-review on RE_REVIEW | same |
| **On failure** | escalate to STRICT on the same head (or `fail`) | replanner | replanner |
| **Resolve rung (`NEEDS_CONTEXT`)** | yes | yes | yes |
| **Terminal sweep + gate** | unchanged, per repo | unchanged | unchanged |
| **Worst case, dispatches per task** | impl + precheck + 2 + verify + fix + guard = 7, then STRICT's | today's | today's + 1–2 lenses |

## 6 · Integration points

| File | Change |
|---|---|
| `workflows/orchestrate-loop.js` | `TASK_ITEM_SCHEMA` (`:256`): `policy`, `policyReason`, `labels`. New `resolvePolicy(t)` beside `routeTask` (`:5661`): floor, raise, history, override, emits `route.policy` + signals. `panelFor(repo, stage)` (`:2356`) → `panelFor(task, stage)`, policy-aware. `runReviewStage` (`:4308`): fix budget and consolidation from the profile. `runTask` (`:4584`): FAST branch, then escalation in place. `modelFor` (`:4483`): STRICT floor. `settle` (`:5715`): `policy`, `escalatedFrom`. `checkpointTaskRecord` (`:5108`): persist `policy` + `escalated`. Preview output: per-task policy and signals. `summary.policyStats`. |
| `workflows/briefs/hydrate.md` | "Propose a policy" section: raise-only, a reason, the labels to read |
| `workflows/briefs/guard.md` | FAST addendum: run `repos[].check` when given; a failure means RE_REVIEW |
| `workflows/briefs/implement.md` | the consolidated-fix header (spec findings first, then quality) |
| `workflows/policies.md` (new) | the profile table; drift-checked |
| `scripts/check-drift.mjs` | the policies table ↔ engine constants |
| `scripts/render-logs.mjs`, `scripts/economy/runs.mjs` | `byPolicy` cost, dispatch and outcome lines; the escalation count |
| `skills/review`, `skills/implement` | apply the resolved profile in a session |
| `skills/orchestrate` | pass `policy`; explain the preview's policy column |
| `scripts/manager.mjs` | the prompt names the policy; `waitsFor` includes repos with a running loop |
| `grimoire.config.example.json` | `policy`, `policies {strictPaths, strictTags, docsPaths, fastMaxFiles, fanOut, historyMaxEscalation, allowBelowFloor, fast: {onFail}}`, `repos[].policy`, `repos[].check` |
| `workflows/README.md`, `CHANGELOG.md` | docs; version bump |

## 7 · Failure modes and safeguards

| Failure mode | Safeguard |
|---|---|
| A risky task routed FAST | hard floors are engine-computed and cannot be lowered without `allowBelowFloor`; terminal sweep and gate unchanged; history raise per repo; escaped defects tracked per policy (§8) |
| A FAST fix shipped unreviewed | guard on the fix diff (unchanged brief, "no test weakened" included) plus the `check` command; anything but PASS escalates |
| A consolidated fix where spec and quality findings conflict | spec findings first in the brief; the guard checks every finding; a conflict surfaces as RE_REVIEW and escalates |
| Escalation redoes work | escalation continues the same in-flight entry, same lane, same head; the range widens to the task's `startSha`; no re-implementation, no second implementer |
| Competing implementations of one task | one `inFlight` entry per id, as today; escalation is a state change on it, not a new dispatch of `impl` |
| A dependent built on unvalidated output | `landed()` unchanged: a FAST task lands only after PASS (or after STRICT passes) |
| Conflicting writes across policies | policies share the lane rules (`files` disjointness, exclusive undeclared footprint, serialized integrate, ship lock) |
| A session (edge) and a loop on one checkout | `waitsFor` extended to running loops; tracker claims (`claim.identity`) already keep the loop off issues others started |
| Resume re-routes a half-escalated task | `policy` and `escalated` persisted in the checkpoint and the PR state marker; resume trusts them over a fresh resolution |
| Lens dilution from fewer reviewers | FAST draws the same personas; the benchmark measures escape rate before `auto` becomes the default |
| Misclassified docs-only | `docsPaths` matches declared **and** reported files; a reported code file in a docs-only task raises it at precheck time (footprint) |
| Floors too broad (everything STRICT) | the preview shows each task's policy and signals before execution; globs are config |
| Interrupted run | unchanged durability: late-not-dead, fencing, PR markers, `resumeState` |

## 8 · Benchmark methodology

**Instrument.** `render-logs.mjs summary --json`, extended with `byPolicy`:
- cost: cache-aware effective tokens and dollars per dispatch, task, tier, lens and repo;
- the journal counters (`dispatch`, `review`, `fix`, `guard`, `verify`, `precheck`, `replan`, `escalate`);
- run active minutes from `run.json` and transcript timestamps.

Nothing new is needed to measure the current engine. The baseline in §3 came from it.

**Metrics:**
- **Total execution time:** active minutes per run, and per-task critical path (dispatch to land).
- **Tokens:** effective tokens and dollars per landed task and per run.
- **Dispatches:** per task and per run, by kind.
- **Review iterations:** stage rounds per task, and the fix-round distribution.
- **Completion rate:** `landingRate`, `runSuccess`, `firstRoundRate`.
- **Escaped defects**, attributed to the task whose files they hit, by its policy:
  - gating findings raised **after** a task landed (terminal sweep, gate failure);
  - PR review threads marked fixed;
  - follow-up commits or reverts on the run branch touching the task's files before merge.
  - The ledger records them, and `crystallize` already reads review threads.

**Three stages, cheapest first:**
1. **Counterfactual, free.** Run `resolvePolicy` over the 15 recorded runs' hydrated tasks (route events, `landed.jsonl` files). Report:
   - the policy mix;
   - the dispatches FAST would have skipped (an upper bound on its saving);
   - how many recorded round-0 failures and terminal findings fell on tasks routed FAST. A miss rate above zero is a routing defect to fix before anything runs live.
2. **Shadow in real runs** (built in: every `route` event records `autoPolicy`, so any run with no policy set is a shadow run; see Implementation notes). The run executes BALANCED and journals what `auto` would have chosen. After 3–5 runs, report the same table with real outcomes. This mirrors how the token-economy loop guard ships.
3. **Controlled A/B.**
   - A fixture project of about 12 seeded issues: a known risk mix, hidden acceptance tests, and 3–4 planted defect traps. One trap is an auth check a FAST task could plausibly drop.
   - Arms: `balanced` (today) vs `auto`, optionally `auto` + combined single reviewer.
   - Three runs per arm, same models, same machine (plugged in, `caffeinate`), same `maxPerRepo`.

**Adoption rule.** `auto` becomes the default only if:
- escaped defects and trap misses do not rise (zero tolerance on traps);
- completion rate does not fall;
- cost or time per landed task drops by at least 10 % on the A/B.

Otherwise policies stay opt-in, and STRICT's promoted lenses can still ship on their own merit.

## 9 · Minimal implementation plan

Vertical slices, smallest first. Each ships with its tests and version bump.

1. **Policy plumbing, shadow.**
   - Schema field, `resolvePolicy`, config, preview column, `route.policy` events, checkpoint persistence, `byPolicy` in logs.
   - No behaviour change; the `auto` pick is journaled on every route event (no mode flag).
   - Includes the counterfactual script over recorded runs.
2. **STRICT.** Promoted lenses by signal, opus floor. A quality gain, independent of FAST.
3. **FAST.** One round, consolidated fix, guard once plus `repos[].check`, escalation in place, `onFail`.
4. **Overrides and history.** Labels, `repos[].policy`, refused-below-floor, ledger-backed raise, `crystallize` reading `byPolicy`.
5. **Edge.** `workflows/policies.md` read by `review` / `implement`; `manager.mjs` prompt and `waitsFor` on running loops.
6. **Benchmark** stage 3, then the default decision.

**Tests.** `workflows/tests/execution-policies.test.mjs`, on the stubbed runtime, one case per brief item:
- mixed FAST / BALANCED / STRICT in one DAG, with ordering and lanes preserved;
- FAST review FAIL, then one consolidated fix, then guard PASS lands;
- FAST guard RE_REVIEW escalates to STRICT on the same head, with no second `impl` dispatch;
- a FAST task failing blocks only its dependents;
- concurrent lanes across policies with overlapping files are held;
- kill and resume mid-escalation keeps the policy (shipped: `checkpoint.policies`; the resumed task's implementer is dispatched again and finds its commits on the branch, as any unlanded task does today);
- a hard-floor task refuses a `fast` override;
- `policy` absent: dispatch sequence identical to 0.15.1 on every existing suite.

## 10 · Where this simplifies grimoire

- **No second orchestrator.** One scheduler, one isolation model, one journal, one resume path.
- **Knobs bundled.** `maxFixAttempts`, `precheck`, `verifyFindings`, `escalateAtFixRound`, `maxPrecheckFixes` and `reviewParallel` are today six global dials. They become three named profiles, with the old knobs as BALANCED's defaults (still honoured for compatibility).
- **One quality definition.** `skills/review` currently restates the panel in prose that drifts from the loop. It would read `workflows/policies.md`, drift-checked like `personas/`. The owner's "one review per issue" memory rule becomes a profile instead of a standing instruction.
- **The discard-and-rerun path goes away for FAST** (consolidated fix). If the benchmark shows consolidation is no worse, it can replace the per-stage fix loop for round 0 in BALANCED too. That removes one of the engine's more intricate branches (`discardRound`, `~h<n>` reruns).
- **The manager and the loop share one routing function.** `routeOf` (roast / orchestrate / implement) picks the *where*, and `resolvePolicy` the *how strict*.

## Edge cases

- **A FAST task in a repo whose terminal sweep then fails.** This is a code failure as today. The replanner's repair task inherits `code` kind and resolves at least BALANCED (D5 raise: replanned after a code failure).
- **A replan-invented task** resolves its policy like any other, from its declared files and the failures it repairs.
- **`maxPerRepo: 1`.** No lanes; policies change nothing about serialization.
- **No tracker labels support.** Overrides fall back to `repos[].policy` and `args.policy`.
- **A FAST task that is already landed (`landedBefore`).** The absorb path runs before any policy logic, unchanged.

## Spikes (facts to establish, not decisions)

- **S1.** Does a combined single reviewer (spec-hawk + break-it lenses in one dispatch) keep the escape rate? It is the one extra saving FAST could take (about one dispatch per task). Benchmark arm C settles it; it is not in the plan until then.
- **S2.** Does the counterfactual (stage 1) show any recorded round-0 failure or terminal finding on a task the router would send FAST? This gates slice 3.

## Implementation notes

Settled while building, inside the approved design:

- **No `policies.mode: 'shadow'` flag.** The router's pick is computed and journaled on every
  `route` event as `autoPolicy`, whatever ran, so a run with no policy *is* the shadow run. One
  knob fewer.
- **The per-task `contract-checker` dispatch (D4) is deferred.** A cross-repo or contract-shaped
  task promotes `data-integrity` (its lens covers schema and contract drift) and runs at the opus
  floor; `finalCheck` still checks cross-repo contracts at project end. A per-task contract
  dispatch needs a verdict adapter for an agent that does not return `VERDICT_SCHEMA`, and its own
  calibration. Revisit if the benchmark shows contract escapes on STRICT tasks.
- **The promoted lenses' globs are config** (`policies.promote: {privacy: [...], 'data-integrity': [...]}`).
- **S2 (0.16.0 counterfactual, 113 recorded tasks):** balanced 96, strict 16, fast 1. No
  round-0 failure on the FAST pick; its one flag is a terminal-sweep finding in its repo (a
  missing IAM grant), not in its files. Recorded runs hold no `dependsOn`, and 38 tasks never
  reached `landed.jsonl` (no files, so raised), so the real FAST share is higher than 1 in 113, but
  not by much: 70 tasks were opus picks and 67 touched more than 3 files.

## Questions owned by you

1. **BALANCED = today, default unchanged; STRICT = today plus lenses (D2).** The alternative is the brief's literal mapping (STRICT = today, BALANCED a lighter middle). Recommended: D2, since no default run loses anything.
2. **FAST failure escalates to STRICT in place (D3), or stops as FAIL** for the replanner? Recommended: escalate. The failure is still journaled and summarized.
3. **Overrides below a hard floor: refused unless `allowBelowFloor` (D7), or honoured and flagged?** Recommended: refused.
4. **Default `strictPaths` / `strictTags`.** Are the globs in D5 right for your repos? The preview shows the effect before any run.
5. **Scope check.** Native background or headless sessions stay out of the design (owner's no-CLI rule, no structured result channel). Confirm you don't want an exception approved here.

## Sources

- **Code and docs** at `origin/main` `5d9dcc1`, extracted to the session scratchpad:
  - `workflows/orchestrate-loop.js`;
  - `workflows/README.md` ("Runtime constraints", "Token economy", task lifecycle);
  - `workflows/briefs/{hydrate,review,guard,precheck}.md`, `workflows/personas/*`, `agents/reviewer.md`;
  - `skills/{implement,review,manager,orchestrate}/SKILL.md`, `scripts/manager.mjs`, `scripts/economy/*`;
  - `docs/specs/2026-10-30-token-economy-design.md`, `CHANGELOG.md` 0.8.0 → 0.15.1.
- **Measurements:** `render-logs.mjs summary --json` over the 15 recorded runs under `~/Awesome/{odyyy-orchestrator,lab,iDeaLex}/.grimoire/runs`, plus a journal counter (`baseline.mjs`, session scratchpad).
- **Claude Code docs** (via the `claude-code-guide` agent, 2026-10-31): [workflows](https://code.claude.com/docs/en/workflows.md), [sub-agents](https://code.claude.com/docs/en/sub-agents.md), [worktrees](https://code.claude.com/docs/en/worktrees.md), [agent-teams](https://code.claude.com/docs/en/agent-teams.md), [agent-view](https://code.claude.com/docs/en/agent-view.md), [headless](https://code.claude.com/docs/en/headless.md), [sessions](https://code.claude.com/docs/en/sessions.md), [cross-session-messaging](https://code.claude.com/docs/en/cross-session-messaging.md), [hooks](https://code.claude.com/docs/en/hooks.md), [monitoring-usage](https://code.claude.com/docs/en/monitoring-usage.md), [costs](https://code.claude.com/docs/en/costs.md).
