# Token economy: plan

**Spec:** [2026-10-30-token-economy-design.md](../specs/2026-10-30-token-economy-design.md) (approved 2026-10-30) · **Input:** [TokenEconomizer research](../research/2026-10-30-tokeneconomizer.md)

## Problem (in the owner's words)

Microsoft's TokenEconomizer makes coding agents cheaper by learning from earlier sessions. We want what fits of it in grimoire, rebuilt ourselves. Grimoire's policy allows no third-party tools beyond the ones already agreed, such as rtk. The work runs through subagents, not `claude -p` or Claude CLI commands.

## Solution (in the owner's words)

1. See what a run really costs, cache included, and cap it.
2. Watch dispatched agents for failing loops. A judge subagent rules on them. A stuck agent gets one redirect, then `BLOCKED`. The watch runs in shadow mode first.
3. Learn environment facts from repeated failures, with no model. Inject them from a separate small store, frozen for a run. `crystallize` promotes the lasting ones into memory.
4. Collect which tools each role loads but never uses. `crystallize` proposes `disallowedTools` for those servers.

## User stories

1. As a maintainer, I want the real cost of every dispatch (input, cache read, cache write, output) in `/grimoire:logs`, so that I know where a run's money goes.
2. As a maintainer, I want that cost for runs that already happened, so that I have a baseline before anything changes.
3. As `crystallize`, I want cost per model tier, lens and repo in `render-logs.mjs summary --json`, so that routing patches rest on the real bill and not on output tokens alone.
4. As a project owner, I want `maxCost` in effective tokens, so that a run halts on what it really spends.
5. As the loop, I want each dispatched agent's tool calls folded into stuck signals, so that a failing loop is seen while it runs and not after.
6. As a maintainer, I want the watch's would-redirect and would-block verdicts in the journal before it acts, and an offline replay over recorded runs, so that I can trust it before turning it on.
7. As an implementer stuck in a loop, I want one redirect with a different angle, and then to be told to return `BLOCKED`, so that the loop's resolve and replan rungs take over instead of my burning the time limit.
8. As someone working interactively, I want the free rules to flag a stuck turn with one line, so that I can press Esc. No model call is made.
9. As a team agent, I want environment facts learned from earlier dispatches in my brief, frozen for the run, so that I don't rediscover "`npx tsc`, not `tsc`".
10. As a human merging `crystallize`'s PR, I want the facts that held, with their counts, proposed as memory entries, so that memory stays reviewed.
11. As a human merging `crystallize`'s PR, I want `disallowedTools` proposals for the MCP servers a role loaded and never used, with counts, so that dispatches stop paying for about 800 unused tool names.

## Seams

Each seam is chosen to match a test style the repo already uses.

| Seam | What crosses it | Test style it follows |
|---|---|---|
| **S-A · `scripts/render-logs.mjs`**: `summary --json` and the HTML report | Cost per dispatch, per task, per tier, per lens, per repo; stuck events; fact and tool evidence | `scripts/render-logs.test.mjs`: a fixture runs dir plus, new, a fixture Claude projects dir passed as `--claude-dir` |
| **S-B · the engine through the stubbed runtime**: `workflows/tests/support/script-harness.mjs` | `maxCost` halting, `stuck-judge` dispatch timing, `BLOCKED` journaling, facts pasted by harness-context | The `workflows/tests/*.test.mjs` pattern: stub `agent()` returns, assert on the prompts and the journal |
| **S-C · the hook**: `hooks/scripts/economy.mjs`, with Claude Code hook JSON on stdin and the hook output on stdout | Per-call fold, redirect and `BLOCKED` context, `SessionStart` facts, the fail-open rule, latency | `hooks/scripts/guard.test.mjs`: spawn the hook with payloads, assert on stdout and exit |

The economy library (`scripts/economy/*.mjs`) has unit tests only where the logic is dense and pinned by TokenEconomizer's own tests:
- command observation;
- the envfacts families;
- the lifecycle;
- `SpiralState` and the shell edits;
- `runner_verdict`.

Everything else is tested at S-A, S-B or S-C.

**How a run maps to its transcripts.** The join is exact, checked on disk:
- `~/.claude/projects/<cwd slug>/<sessionId>/workflows/wf_*.json` carries `args.runId`, which is grimoire's runId.
- Its agents are in `<sessionId>/subagents/workflows/<wf id>/agent-<id>.jsonl`.
- Each agent has a `.meta.json` (`description` is the `agent()` label; it also holds `agentType`, `model` and `workflowPhase`) and a `.prefix.json` (`state.toolNames`).
- A resumed run has one `wf_*.json` per session.

The Claude directory is `$CLAUDE_CONFIG_DIR`, else `~/.claude`, overridable with `--claude-dir` in tests.

**Names.**
- The loop already has a `guard` dispatch (the post-fix guard, `workflows/briefs/guard.md`) and a guard hook. So the new journal event is **`stuck`**, with `action` ∈ `would-redirect | would-block | redirect | block | spared`. The dispatch kind is **`stuck-judge`**, and its brief is `workflows/briefs/stuck-judge.md`.
- The config key stays `economy.loopGuard`, as in the spec.
- The spec's `guard_redirect` and `guard_block` are these events under their final names. The spec is updated to match.

**Where state lives.** `.grimoire/economy/`, resolved to the main checkout the way `scripts/project-config.mjs` resolves the config:

| Path | Holds |
|---|---|
| `turns/<agent_id>.json` | per-agent watch state |
| `judge/<agent_id>.request.json`, `judge/<agent_id>.result.json` | judge requests and verdicts |
| `envelope.json` | the per-(repo, agent type) envelope |
| `facts/<repo>.json` | learned facts |
| `tools.json` | loaded-versus-used tool evidence |
| `folded.json` | which sessions and dispatches were folded |
| `errors.log` | the hook's fail-open log |

## Vertical slices (smallest first)

Every slice ends with `npm test`, `npm run check` and a CHANGELOG entry. Files that port TokenEconomizer logic carry the attribution header (source file, commit `1deb887`, Apache-2.0).

### Slice 1 · Cost truth in `/grimoire:logs`
- **New: `scripts/economy/transcript.mjs`.**
  - Reads calls (deduplicated by `tool_use.id`, `api-request-blob` entries skipped).
  - Reads usage deduplicated by `message.id`, keeping the last entry.
  - Reads cache writes split into `ephemeral_5m` and `ephemeral_1h`, falling back to `cache_creation_input_tokens` as 5-minute.
  - Reads the model, plus the meta (`agentType`, `description`, `model`, `workflowPhase`) and the prefix tools.
  - Folds subagent files into a session.
- **New: `scripts/economy/pricing.mjs`.**
  - Effective tokens = `in·1 + read·0.10 + write5m·1.25 + write1h·2.0 + out·5`.
  - An unknown model is priced at the Claude weights and labelled `priced_by: fallback`. It never throws.
  - The optional USD table in config, `economy.prices`, was not built in slice 1, which needs none. It moves to slice 4 (#50), the first slice that reads it.
- **New: `scripts/economy/runs.mjs`.**
  - Finds the `wf_*.json` files whose `args.runId` matches.
  - Returns one bill per dispatch, keyed by label, and the run total.
- **Changed: `render-logs.mjs`.**
  - The report gets a cost column per dispatch, and totals per task, model tier, lens, repo and dispatch kind, including mechanical dispatches (the spec's non-goal stays measured).
  - `summary --json` gets the same aggregates plus `costCoverage`, the share of dispatches matched to a transcript.
  - Works for old runs: there is no new engine field.
- **Changed: `scripts/run-tests.mjs`** picks up `scripts/economy/*.test.mjs`.
- **Changed: `skills/crystallize/SKILL.md`.** The routing-rubric row cites effective cost, not output tokens. Eval case added.
- **Done when:**
  - `/grimoire:logs` on a fixture run shows each dispatch's cost, and its totals match a hand-computed fixture.
  - A real run on this machine renders with `costCoverage` near 100 %.

### Slice 2 · `maxCost`
- **Engine.**
  - New option `maxCost`.
  - The journal brief and script run `node <plugin>/scripts/economy/runs.mjs cost --run <runId> --root <ROOT>` after writing. The writer returns `costSoFar`. The engine checks it before every dispatch, next to `maxOutputTokens`.
  - Crossing it halts as `budget_exhausted` with a reason that names the cost cap.
  - A resumed run counts earlier sessions' cost, because every `wf_*.json` of the runId is read.
  - A missing or unreadable cost means no halt, and one `budget` journal event saying the cap is blind.
- **Changed files:**
  - the journal writer region in the engine;
  - `workflows/scripts/journal-writer.sh`, regenerated with `npm run journal:writer`;
  - `workflows/briefs/journal.md`;
  - `grimoire.config.example.json` and `scripts/config-merge.mjs` (key known and merged);
  - `workflows/README.md`: the Optional knobs table, and the "Cost fuse" paragraph says what each cap sees;
  - `skills/setup/SKILL.md`: proposes `maxCost` beside `maxOutputTokens`, with an eval case.
- **Done when** an S-B test has a stubbed journal writer return a rising `costSoFar`, and the engine stops dispatching, lets in-flight work settle, and halts `budget_exhausted` with the cost reason. A resumed run carries the cost over.

### Slice 3 · Loop guard, shadow
- **New: `hooks/scripts/economy.mjs`.**
  - Registered in `hooks/hooks.json` on `PostToolUse`, `PostToolUseFailure` and `SubagentStop`.
  - Inside a subagent (when `agent_id` is present) it folds the call into `turns/<agent_id>.json`:
    - `SpiralState`, with the rtk prefix stripped;
    - failure signatures (first error line, hex, numbers and paths masked, hashed);
    - `runner_verdict` for piped test runs;
    - shell edits.
  - It applies the gate. When the gate opens, it writes `judge/<agent_id>.request.json` (the digest, never file contents).
  - In shadow mode, it reads any result and journals locally (`turns/<agent_id>.json` events) what it would have done. It outputs `{}`.
  - Every failure path is `{}` plus a line in `errors.log`.
  - Recursion is guarded with `GRIMOIRE_ECONOMY=0`.
- **New: `scripts/economy/loopguard/`.**
  - `state.mjs`, `shell-edits.mjs`, `rules.mjs` (gate, `is_stuck`, backstop, the redirect template) and `envelope.mjs` (p90 × 1.25, at least 5 samples, per (repo, agent type), fed at `SubagentStop` only by dispatches that stopped normally with no failing check after their last edit).
  - Ported with TokenEconomizer's pinned cases as unit tests.
- **Engine.**
  - While a writer dispatch is in flight past `economy.judgeAfterMin`, a `setTimeout` loop dispatches **`stuck-judge`** every `economy.judgeEveryMin`: haiku, `effort: 'low'`, at most one in flight.
  - Its brief, `workflows/briefs/stuck-judge.md`, says:
    - read the pending requests;
    - rule `{stuck, confidence, reason, redirect}` for each, favouring sparing;
    - write the results;
    - return the list.
  - The engine journals one `stuck` event per verdict: `would-redirect` or `would-block` when stuck with confidence ≥ 0.7, `spared` otherwise.
  - `economy.sidecallBudgetUsd` (converted with `economy.prices`, or counted as effective tokens when there is no price table) is checked from the `stuck-judge` dispatches' bills (slice 1). When it is spent, no more judges run.
- **New: `scripts/economy/replay.mjs`.**
  - Runs the hook's fold, the gate and the free rules over recorded workflow transcripts.
  - Prints, per (repo, agent type): gated dispatches, `is_stuck` hits, envelope and backstop hits, and the cost of the flagged dispatches.
  - It never calls a model.
- **Also:**
  - `render-logs.mjs` shows the `stuck` events and the judge's cost;
  - `grimoire.config.example.json` and `config-merge.mjs` get the `economy` block;
  - the drift check covers the new brief;
  - `hooks/README.md` gets the hook's row and its latency rule.
- **Done when:**
  - an S-C test feeds 20 failing calls with the same signature and gets a request file, with output `{}`;
  - an S-B test sees `stuck-judge` dispatched after the threshold and a `would-redirect` journaled;
  - replay over this machine's recorded runs prints a table;
  - the hook's median latency stays under 30 ms (spike S2).

### Slice 4 · Loop guard on
- **Prerequisite: spike S1.** Does `PostToolUse` `additionalContext` reach the subagent? The owner runs a throwaway session with a hook that injects a codeword. If the context lands in the parent, stop and roast the gap.
- **Hook (under `loopGuard: on`).**
  - On a ready verdict it answers with `hookSpecificOutput.additionalContext` under the incoming event name (`PostToolUse` or `PostToolUseFailure`). The text is the redirect (the judge's, else the template), and the watch's segment is reset.
  - The next stuck verdict in the same dispatch is answered with a context line: stop now and return `BLOCKED` with what you tried and this reason.
  - The backstop at 2.5 × the envelope redirects without the judge when one is due.
- **Engine.**
  - Journals `stuck` `redirect` and `block`.
  - A `BLOCKED` return whose summary carries the watch's reason goes to the resolve rung as today. The resolve brief gets one line: a watch-blocked agent's digest is evidence of what failed.
- **Interactive (D10).**
  - Main-session calls (no `agent_id`) are keyed by `prompt_id` and closed at `Stop`. `UserPromptSubmit` is registered.
  - The free rules only: `is_stuck` plus the backstop. One redirect line, then a `systemMessage` notice. No judge.
- **Done when:**
  - S-C tests show a ready verdict producing the redirect, then the `BLOCKED` line;
  - a failure answer names `PostToolUseFailure`;
  - a main-session loop gets the free-rule line;
  - an S-B test routes a watch-blocked `BLOCKED` into resolve.
- **Release note:** the default stays `shadow` in this release (D11). Flipping the default is a one-line follow-up release.

### Slice 5 · Learned environment facts
- **New: `scripts/economy/facts/`.**
  - `observe.mjs`:
    - segmentation that unwraps `sh -c`, elides heredocs and splits outside quotes;
    - prefix stripping for rtk, `VAR=`, `sudo`, `env`, `time` and `timeout N`;
    - carried `cd` and activation prefixes;
    - intent and form;
    - error classes;
    - attribution of outcomes in compound commands.
  - `families.mjs`: form repair, arg repair, env value, boundary, empty probe, each with TokenEconomizer's exact triggers.
  - `lifecycle.mjs`:
    - 3 confirmations;
    - a score of 0.8^age, with contradictions weighted 5×;
    - high-stakes facts retire on one contradiction;
    - the firing gate is ≥ 40 % over ≥ 4 exercised dispatches;
    - a prevented failure still counts as fired.
  - `render.mjs`: at most 4 facts and about 600 characters, priority order, merged form-repair lines, and the advice lint.
- **Fold.**
  - At `SubagentStop` (using `agent_transcript_path`) and at `SessionEnd`, each dispatch or session is folded once, recorded in `folded.json`, under a lock. When the lock times out, the fold is skipped and never written unlocked.
  - The repo is matched from the calls' working directory against `repos[].path`.
- **Injection.**
  - `SessionStart` (source `startup`, `clear` or `compact`) returns the repo's rendered block as `additionalContext`.
  - The harness-context loader's prompt reads `.grimoire/economy/facts/<repo>.json` for the run's repos and returns the rendered blocks. `memoryBlock(agent)` pastes the repo's block under "## Learned environment facts (machine-observed; you never write them)". It is read once per run, so the block is frozen.
- **`crystallize`.** The summary lists facts that have stayed active over at least N runs, with their counts. The skill proposes them as memory entries in its PR. Eval case added.
- **Done when:**
  - unit cases from TokenEconomizer's pinned behaviour pass;
  - an S-B test sees the facts block in an implementer's prompt, unchanged across the run;
  - an S-C test gets the block at `SessionStart` and nothing on `resume`.

### Slice 6 · Tool evidence per role
- **Fold** records per (repo, agent type): the loaded tools (`prefix.json` plus the deferred-tool deltas) and the used tools, with subagents counted. The counters are dispatches and runs.
- **Candidates.**
  - Group by MCP server.
  - A server qualifies when it went unused over ≥ 10 dispatches across ≥ 2 runs, or over 5 runs.
  - Protected built-ins never qualify, and neither does anything ever used.
  - `mcp__ccd_*` (the desktop app's own tools) always qualifies.
- **`render-logs.mjs summary --json`** gets `toolEvidence` per role: candidate servers, their tool counts, and the estimated cost of the deferred names.
- **`crystallize`** proposes `disallowedTools: mcp__<server>, …` on the role's definition, with counts. Eval case added.
- **`templates/team-agent.md`** and the setup skill add the `mcp__ccd_*` denial to new team agents. Eval case added.
- **Done when:**
  - the summary on this machine's recorded runs names the never-used servers per engineer role;
  - it does not name the simulator, browser, fal or Vercel servers for the roles that used them.

## Order and dependencies

```
1 cost ──► 2 maxCost
   └─────► 3 loop guard (shadow) ──► 4 loop guard (on)   [needs spike S1]
5 facts         (independent of 2–4; uses slice 1's transcript reader)
6 tool evidence (independent of 2–5; uses slice 1's transcript reader)
```

Slices 2, 3, 5 and 6 can run in parallel once slice 1 has landed. They touch different files, except:
- `grimoire.config.example.json` and `config-merge.mjs` (slices 2, 3, 5);
- `render-logs.mjs` (slices 3, 6).

Those are small additive edits; serialize them at integration.

## Spec deltas made here (naming only)

| Spec said | Plan says | Why |
|---|---|---|
| journal events `guard_redirect` / `guard_block`, dispatch `guard-judge` | event `stuck` with an `action`; dispatch `stuck-judge` | the loop already has a `guard` dispatch and a guard hook |
| "join to the journal by label" | join by `wf_*.json` `args.runId`, then by label | exact, and a resumed run's sessions all match |
