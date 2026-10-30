# Token economy: design

**Status:** proposed, awaiting approval · **Date:** 2026-10-30 · **Input:** [the TokenEconomizer research](../research/2026-10-30-tokeneconomizer.md)

## Problem

Grimoire cannot see what a run costs. The loop's only usage counter is `budget.spent()`, which counts cumulative output tokens (`workflows/orchestrate-loop.js:2549`). The cost fuse (`maxOutputTokens`), the journal's `tok`, `/grimoire:logs` and `crystallize`'s routing patches all rest on that counter.

We measured 3,357 recorded loop dispatches on the maintainer's machine (2026-10-30). Their cost, cache-aware, was about 1.02 billion effective tokens:

| Where the cost goes | Share |
|---|---|
| Output tokens (all the fuse sees) | **5.9 %** |
| Cache reads | about 60 % |
| Implementer dispatches | 51.5 % |
| 33 implementer dispatches (2.3 % of them) with ≥ 18 calls and ≥ 3 repeated failure signatures: TokenEconomizer's loop-guard gate | 16.6 % |
| The deferred tool-name list carried by every team-engineer dispatch (≈ 8.7 k tokens, ≈ 775 of them MCP) | ≈ 5 % |
| Short mechanical dispatches (≤ 3 requests) writing a cache prefix they barely read back | ≈ 7 % |

Effective tokens here mean `in·1 + cacheRead·0.10 + cacheWrite·1.25 + out·5`.

Nothing in grimoire watches *inside* a dispatch. An implementer that reruns the same failing test forty times is noticed only when it returns or misses its time limit.

[microsoft/TokenEconomizer](https://github.com/microsoft/TokenEconomizer) (Apache-2.0) attacks the same waste in interactive sessions with three mechanisms and a cache-aware ledger. Grimoire rebuilds what fits, under its own rules: no dependency, Node only, and no `claude -p` or Claude CLI calls (model work runs as subagents).

## Goals (v1)

- **Cost truth.** Every dispatch's cache-aware bill is attached to its journal event and shown in `/grimoire:logs`. `crystallize` reads it in its summary.
- **A cost cap a run can trust.** `maxCost`, in effective tokens, sits beside `maxOutputTokens`.
- **A loop guard for dispatched agents.** It folds each tool call, applies a free gate, and calls a judge subagent. A stuck agent gets one redirect, then `BLOCKED`. The guard ships in shadow mode first.
- **Learned environment facts.** These come from repeated failures, with no model call. They are injected from a separate machine store, frozen for the length of a run, and `crystallize` proposes the durable ones as memory entries.
- **Tool evidence per role.** `crystallize` proposes `disallowedTools` entries for the MCP servers a role loads but never uses.

## Non-goals (v1)

- Cutting the mechanical-dispatch cache cost (journal, ship, env, preflight; about 7 %). It is an engine restructuring with its own roast. Slice 1's reports track it.
- A paid fact proposer (TokenEconomizer's `distiller.py`). `crystallize` is the reviewed proposer.
- A repository map (TokenEconomizer's aider-based one). The code graph covers it.
- Writing permission settings by any automatic means.
- Support for Codex, Copilot, Pi or opencode. The reader interface stays open to them.
- Any `claude -p` or Claude CLI call. That covers the judge, the catalog probe and the cost probe.
- A judge in interactive sessions. Those use the free rules only.

## Decisions

**D1. Cost is read from transcripts, after the fact, by Node scripts.**
- The reader is `scripts/economy/transcript.mjs`. It reads:
  - the main transcript;
  - `<session>/subagents/agent-<id>.jsonl`;
  - `<session>/subagents/workflows/<wfRunId>/agent-<id>.jsonl` with `.meta.json`, which holds `agentType`, `description` (the loop's `label`), `model` and `workflowPhase`;
  - `.prefix.json`, whose `state.toolNames` lists the loaded tools.
- Usage is deduplicated by `message.id`, keeping the last entry. `api-request-blob` entries are skipped. Cache writes are priced by TTL: 5 minutes at 1.25, 1 hour at 2.0. Loop dispatches write 5-minute entries only; interactive sessions write 1-hour ones.
- A dispatch's bill is joined to its run by the workflow file's `args.runId`, then to its journal event by label.
- **Rejected: a cost probe through the CLI.** It was unnecessary, and it is excluded by D9.

**D2. `maxCost` is added, and `maxOutputTokens` is kept.**
- `maxCost` is in effective tokens. The journal writer, already a periodic agent, runs the cost script over the run's dispatches and returns the total, so the cap trails by one flush.
- Crossing either cap halts the run as `budget_exhausted`, in the existing way.
- **Rejected: replacing `maxOutputTokens`.** That would change what an existing config number means.
- **Rejected: report-only.** The fuse would keep watching 6 % of the bill.

**D3. The loop guard is keyed per subagent.**
- One hook dispatcher, `hooks/scripts/economy.mjs`, runs on `PostToolUse` and `PostToolUseFailure`. It keys guard state by the hook input's `agent_id` and closes it at `SubagentStop`.
- The per-call logic is ported from TokenEconomizer:
  - `SpiralState`;
  - normalised failure signatures;
  - `runner_verdict` for piped test runs;
  - shell-edit detection;
  - the gate (≥ 18 calls, and a repeated failure or ≥ 8 error outputs);
  - `is_stuck`;
  - the backstop at 2.5 × the envelope.
- The envelope is the 90th percentile of resolved dispatches × 1.25, with at least 5 samples, kept per **(repo, agent type)**.
- State lives in one file per agent, `.grimoire/economy/turns/<agent_id>.json`, which also fixes TokenEconomizer's unlocked shared-file race.
- **Rejected: TokenEconomizer's prompt-keyed guard.** It skips subagents, and every loop dispatch is a subagent.

**D4. The judge is a workflow subagent, dispatched by the engine.**
- The hook never calls a model. When the gate opens, it writes a judge request (the digest) to `.grimoire/economy/judge/<agent_id>.request.json`.
- While an implementer has been in flight past a threshold, the engine's timer dispatches a small haiku `stuck-judge` agent. The agent reads the pending requests, rules on each (`stuck`, `confidence`, `reason`, redirect text) and writes `.result.json`.
- The hook delivers the verdict on the agent's next tool call. The judge has a fresh context, so it is independent of the stuck agent.
- **Rejected: `claude -p` side calls** (D9).
- **Rejected: `type: "prompt"` or `type: "agent"` hooks.** They cannot be gated by our state, so they would pay a model call on every tool call.

**D5. After the redirect, a still-stuck agent is told to return `BLOCKED`.**
- The guard gives one redirect: TokenEconomizer's text, asking for a materially different hypothesis and not to stop. It is sent as `additionalContext`, answered under the event name it came from.
- If the agent is still stuck, a second line tells it to return `BLOCKED` with what it tried and the judge's reason.
- The loop's resolve and replan rungs take over. The journal records `stuck` events (`redirect`, `block`; see the plan for the naming).
- **Rejected: redirect-only, TokenEconomizer's rule.** Nobody is watching an unattended run.
- **Rejected: forcing escalation to opus.** It skips the resolve rung's diagnosis.

**D6. The judge's spend has its own cap.**
- The cap is `economy.sidecallBudgetUsd`, measured from the `stuck-judge` dispatches' transcripts. When it is spent, the guard falls back to the free rules (`is_stuck` and the backstop).
- **Rejected: counting it inside `maxCost` only**, which was the recommendation. The owner chose a separate budget.

**D7. Learned facts are injected from a separate machine store.**
- The store is local, in `.grimoire/economy/facts/`, which is gitignored.
- What is ported:
  - `observe.py`'s command segmentation and intent/form classification, with the rtk prefix stripped first;
  - the five LLM-free families: form repair, arg repair, env value, boundary, empty probe;
  - `lifecycle.py`: 3 confirmations, 5× decayed contradictions, and a firing gate of ≥ 40 % over ≥ 4 exercised dispatches;
  - rendering capped at 4 facts and about 150 tokens, with the advice lint.
- Facts are keyed by `repos[].name`, matched from each call's working directory.
- Injection:
  - interactive sessions get the facts at `SessionStart`;
  - in the loop, the harness-context loader reads them once per run and pastes them beside the repo's memory, so the cached brief prefix never changes mid-run.
- `crystallize` lists durable facts with their counts and proposes them as memory entries in its PR. Memory itself is still written only by `crystallize` and merged by a human.
- **Rejected: candidates only.** Every fact would wait for a reviewed PR.
- **Rejected: interactive only.**

**D8. Tool pruning denies the servers a role never used, through `crystallize`.**
- The fold records, per (repo, agent type), what was loaded (`prefix.json` plus the deferred-tool deltas) and what was used.
- Thresholds are TokenEconomizer's, with "prompts" read as dispatches: unused over 10 across ≥ 2 runs, or over 5 runs. Its protected set is never proposed.
- `crystallize` proposes `disallowedTools` entries on the role's definition, by server (`mcp__<server>`), always including the desktop app's own `mcp__ccd_*` tools. It fails open: a teammate's differently named connectors are untouched.
- Restoring a server means deleting a line. Changes land between runs, through a merged PR, which is also the only cache-safe moment.
- **Rejected: a `tools:` allowlist.** It fails closed for teammates whose connector ids differ.
- **Rejected: report-only.**
- **Rejected: TokenEconomizer's automatic `settings.local.json` writes.**

**D9. No `claude -p` and no Claude CLI.** This is the owner's rule.
- Model work runs as subagents.
- The tool catalog comes from `prefix.json`, not a probe.
- Cost comes from transcripts, read by Node scripts.

**D10. Interactive sessions get the free guard rules only.**
- `is_stuck`, the backstop, then one redirect line. Keyed by `prompt_id` for the main session.
- No judge, because no engine is there to dispatch it, and a person is there to press Esc.

**D11. Defaults.**
- `cost: on`, `facts: on`, `tools: evidence` (only `crystallize` acts on it).
- `loopGuard: shadow` in the first release. It judges and journals "would redirect" or "would block" and changes nothing. It becomes `on` in the next release, once offline replay and live runs show its verdicts hold.

## Config (added to `grimoire.config.example.json`)

```json
"maxCost": null,
"economy": {
  "cost": "on",
  "facts": "on",
  "tools": "evidence",
  "loopGuard": "shadow",
  "judgeModel": "haiku",
  "judgeAfterMin": 10,
  "judgeEveryMin": 5,
  "sidecallBudgetUsd": null,
  "loopGuardThresholds": {}
}
```

`loopGuardThresholds` pins any of TokenEconomizer's `loopguard.<name>` values.

## Vertical slices (smallest first)

1. **Cost truth.**
   - Transcript reader, pricing, and the label join.
   - Cost per dispatch, task, model tier, lens and repo in `/grimoire:logs` and in `render-logs.mjs summary --json`.
   - Backfilled over existing runs. No hooks.
2. **`maxCost`.** The journal writer returns the run's effective cost, and the engine halts on it.
3. **Guard, shadow.**
   - The hook dispatcher with per-agent state, the gate, the envelope, request files.
   - The engine's `stuck-judge` dispatches and the journal events.
   - An offline replay script over recorded transcripts that reports the gate's and rules' precision.
4. **Guard, on.**
   - Redirect, then `BLOCKED`, wired into the resolve rung.
   - Interactive free rules (D10).
   - Needs spike S1.
5. **Facts.**
   - Observe, the five families, the lifecycle, the store.
   - Injection at `SessionStart` and through harness-context, frozen per run.
   - The `crystallize` promotion section.
6. **Tool evidence.**
   - Loaded-vs-used per role.
   - `crystallize`'s `disallowedTools` proposals with counts.
   - Setup's team-agent template gains the `mcp__ccd_*` denial.

## Edge cases and failure modes

- **Hook latency.**
  - The per-call hook runs for every tool call of every agent. Budget: under about 30 ms.
  - No model call, no git subprocess, and no transcript read on the hot path.
  - It fails open, writing `{}` and a line in `.grimoire/economy/errors.log`.
  - The session probe (`maxToolLatencySec`) covers it.
- **Concurrency.**
  - Parallel lanes run hooks at the same time. One state file per `agent_id` gives each writer its own file.
  - The envelope and fact stores are appended under a lock. If the lock times out, the sample is dropped, never written unlocked. (TokenEconomizer writes anyway.)
- **Fold idempotency.** Each dispatch or session is folded once, recorded in `folded.json`. A resumed run's replayed dispatches are never re-folded.
- **Judge timing.**
  - A verdict lands on a later call. If the agent has finished first, the verdict is journaled and dropped.
  - A request superseded by a newer segment is ignored.
  - A judge dispatch that dies leaves the request pending. The next tick retries it, within the cap.
- **rtk.**
  - Strip the `rtk [proxy]` prefix before classifying.
  - Failure signatures are computed on condensed output. Slice 3's replay checks that the signatures still repeat.
- **Prevented failures must still count as fired** (`seed_injected`). Otherwise a working fact erases its own evidence.
- **Cold start.** The guard is inert until 5 resolved dispatches of that (repo, agent type). Facts first inject at the fifth exercised dispatch.
- **Cache safety.**
  - Facts are frozen per run, and tool changes land between runs.
  - Hook context is added only after a tool result. `SessionStart` adds it only at startup, clear or compact, and on resume the session replays its own bytes.
- **Unknown model in pricing.** Fall back to the Claude curve, labelled `priced_by: fallback`. Never throw.
- **Worktrees.** `.grimoire/economy` resolves to the main checkout, the way `project-config.mjs` does for the config, so lanes share what is learned.

## Spikes (facts to establish, not decisions)

- **S1.** Does `PostToolUse` `additionalContext` reach the *subagent's* context, not the parent's?
  - The hooks documentation says hooks fire inside subagents with `agent_id` and `agent_type`, but it does not say where the context goes.
  - A live test was blocked by the auto-mode classifier (it starts a session with permissions bypassed). The owner runs it, or approves it.
  - It gates slice 4.
- **S2.** The hook's per-call latency under a parallel loop.
- **S3.** Does a `stuck-judge` dispatch while implementers are in flight cost queue time? The runtime caps concurrent agents (`workflows/README.md`, "Queue time counts toward every limit").

## Questions still owned by the user

- None open. The owner's answers in this roast are recorded as D2, D5, D6, D7, D8, D9, D10 and D11. The scope of the mechanical-dispatch cost was left unanswered, and is taken as the recommended default (a non-goal). Veto it below.

## Sources consulted

- **TokenEconomizer**, commit `1deb887`, read in full by three read-only forks: micro-skills; tool pruning, trace and pricing; loop guard and runtime. Their specs are summarised in the research doc.
- **Grimoire's code and docs**:
  - `workflows/orchestrate-loop.js`: telemetry at 2549, the cost fuse at 2873, the harness-context loader at 674, dispatch labels;
  - `workflows/README.md`: Runtime constraints, Token economy;
  - `hooks/hooks.json`, `hooks/README.md`, `memory/README.md`, `skills/crystallize/SKILL.md`, `templates/team-agent.md`, `grimoire.config.example.json`, `.gitignore`.
- **Claude Code transcripts on this machine**:
  - 3,357 workflow subagent transcripts with `meta.json`; 1,434 with `prefix.json`;
  - this session's own transcript, for the cache-TTL fields.
- **Claude Code docs**, via the `claude-code-guide` agent: [hooks](https://code.claude.com/docs/en/hooks), [sub-agents](https://code.claude.com/docs/en/sub-agents). These settled `SubagentStart` context, the `SubagentStop` `agent_transcript_path` field, and `disallowedTools` semantics.
- **Scripts used for the measurements** live in the session scratchpad (`cost.mjs`, `cache.mjs`, `tools.mjs`, `defsize.mjs`). Slice 1 replaces them.

## Self-answered questions (veto any)

| Question | Answer | Source |
|---|---|---|
| Can a dispatch's transcript be tied to its journal event? | Yes, by label. | `meta.json.description` equals the `agent()` label (`parse-index`, `hydrate:w1`, `harness-context`, …) |
| Do workflow agents record their loaded tools? | Yes: `prefix.json.state.toolNames`, plus `deferred_tools_delta` attachments. | 1,434 `prefix.json` files under `subagents/workflows/` |
| Which cache TTL do loop dispatches write? | 5-minute only (289 M); interactive sessions write 1-hour. | transcript usage `cache_creation.*` |
| Does `SubagentStart` take `additionalContext`? | Yes, injected before the subagent's first prompt. | hooks docs |
| Does `disallowedTools` take whole MCP servers? | Yes: `mcp__<server>` or `mcp__<server>__*`, applied before `tools:`. | sub-agents docs |
| Do engineers use MCP tools? | Some, per role: simulator (app), browser (webapp), fal and Vercel (lab), tracker reads. A blanket `mcp__*` deny would break them. | loaded-vs-used over the recorded dispatches |
| Is `.grimoire/` gitignored? | Yes. | `.gitignore` |
| Do facts, cost and tool evidence need a model? | No, all deterministic. | TokenEconomizer's envfacts, trace and toolprune |
| Defaults for cost, facts and tools | `on`, `on` and `evidence`. | they cost no model calls; only `crystallize` acts on tools |
| Is the mechanical-dispatch cache cost in scope? | No, a non-goal with its own follow-up (unanswered, taken as recommended). | measured at about 7 % |

## Docs drift fixed

| Document | What it said | What is true | Fixed where |
|---|---|---|---|
| `docs/research/2026-10-30-tokeneconomizer.md` | 1-hour cache writes mean TokenEconomizer's 1.25 weight under-counts "our" cache writes by about a third | loop dispatches write 5-minute entries only; 1-hour comes from interactive sessions | that doc, §2a |
| same | the judge runs as `claude -p` | the owner excludes CLI calls; the judge is a workflow subagent (D4) | that doc, §2b |
| same | `SubagentStart` context support unknown | documented | that doc, §7 |

`workflows/README.md`'s claim that `budget.spent()` is the only usage counter a *script* gets is still true. D1 reads cost outside the script, so that document needs no change.

## Reference projects (pattern adopted · not adopted)

**[microsoft/TokenEconomizer](https://github.com/microsoft/TokenEconomizer)**, Apache-2.0, commit `1deb887`.

*Adopted:*
- the trace reader's deduplication rules;
- the cache-aware cost formula;
- `SpiralState`, the gate, `is_stuck`, the envelope, the redirect text;
- the micro-skills observe, envfacts and lifecycle logic, with its caps and lint;
- tool-evidence thresholds and the protected set.

*Not adopted:*
- the prompt-keyed guard that skips subagents;
- `claude -p` side calls;
- the paid distiller;
- the aider repo map;
- automatic writes to `settings.local.json`;
- Codex capability pruning;
- the other agents' readers;
- the benchmark harness.

Files that port its logic carry a header naming the source file, the commit and the licence. The CHANGELOG credits it.
