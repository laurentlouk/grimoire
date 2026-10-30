# TokenEconomizer: what it does, and how grimoire would rebuild it

Research input for a token-economy feature, meant to feed `/roast`. Nothing here is decided.

> **Policy.** [microsoft/TokenEconomizer](https://github.com/microsoft/TokenEconomizer) is not a dependency, not installed, not called. It is Apache-2.0, so its logic, thresholds and regexes may be copied and adapted, with attribution in the files that borrow them. grimoire rebuilds what fits in Node (≥ 20, no dependencies, like `hooks/scripts/guard.mjs` and `tools/graph`). rtk stays the one agreed third-party tool, and it complements this work: rtk shrinks each tool *result*, TokenEconomizer cuts *repeated* work across sessions.

**Source studied.** Commit `1deb887` (2026-10-29): about 13,600 lines of standard-library Python in `tokeneconomizer/`, plus plugin glue for five agents and a benchmark harness. The core was read in full on 2026-10-30. `file:line` citations below point into that commit.

---

## TL;DR

1. **What it is.** A plugin that reads an agent's *finished* sessions in a repository and changes what later sessions there pay for. It has three mechanisms and one accounting layer:
   - **micro-skills**: environment facts learned from repeated failures, injected at session start;
   - **tool pruning**: tools a repository never uses are denied in the agent's own settings;
   - **loop guard**: a turn stuck in a failing loop is detected, judged by a cheap model and redirected;
   - **cost ledger**: cache-aware cost per session, read from the transcripts.
   The paper reports 18–31 % lower mean cost on SWE-Bench, with Pass@1 up in 4 of 5 agent–model pairs.
2. **It does not work in grimoire as shipped.**
   - The loop guard skips every subagent (`plugin/controller.py`, "skip subagents"), and the unattended loop's work all happens in subagents.
   - Its unit of learning is an interactive *session*. Ours is a *dispatch* (one implementer, scout or reviewer run).
   - It writes permission settings by itself, and grimoire forbids exactly that: the guard blocks agent edits to `.claude/settings*.json`, and `crystallize` never touches permissions.
3. **What fits, in order of value to grimoire:**
   - **(a) Cost truth.** The loop's cost fuse sees only output tokens (`budget.spent()`, `orchestrate-loop.js:2549`). The transcripts hold the full, cache-aware bill of every dispatch.
   - **(b) A loop guard for dispatched agents.** An implementer spinning on the same failure for an hour is the most expensive thing an unattended run does.
   - **(c) Learned environment facts**, the LLM-free half of micro-skills only, frozen per run.
   - **(d) Tool evidence per role**, feeding `crystallize` proposals for each agent's `tools:` / `disallowedTools`, never an automatic settings write.
4. **What we drop:**
   - the paid fact proposer (`crystallize` already does that job, with a human in the loop);
   - the repo map (aider's, through a second Python; the code graph does this better);
   - Codex, Copilot, Pi and opencode support;
   - the benchmark harness.
5. **Claude Code already gives us three things TokenEconomizer had to work around** (verified on disk on 2026-10-30, see "Facts checked"):
   - each subagent's transcript, with an `agentType` and a `description` that is the loop's dispatch label;
   - each subagent's **loaded tool list** (`prefix.json`), so no `claude -p` probe is needed;
   - cache writes split by 5-minute and 1-hour TTL.

---

## 1. TokenEconomizer in one page

| Piece | Where | What it does | Calls a model? |
|---|---|---|---|
| Trace readers | `trace/` | Turn each agent's session log into one shape: `(tool, args, result, ok, cwd)`, plus usage and prompts | no |
| Micro-skills, free layer | `microskills/observe.py`, `envfacts.py`, `lifecycle.py` | Classify every shell command by intent and spelling, find five recurring shapes of evidence, and promote or retire facts by a lifecycle | no |
| Micro-skills, paid layer | `microskills/distiller.py` | Every *k* = 3 sessions, a model reads digests of the last 8 sessions and proposes facts, each with a regex detector | yes (haiku) |
| Tool pruning | `toolprune/`, `plugin/denylist.py` | Count prompts and sessions in which each loaded tool went unused, then deny it in `.claude/settings.local.json` | no |
| Loop guard | `loopguard/` | Fold each tool call into per-turn state. A free gate decides when a turn is worth judging; a background judge rules stuck or not; a stuck turn gets a redirect, then a notice | yes (haiku), only when gated |
| Ledger and pricing | `ledger.py`, `pricing.py`, `plugin/accounting.py` | Cost in fresh-input-token equivalents (`in·1 + cacheRead·0.10 + cacheWrite·1.25 + out·5`), with its own overhead charged | no |
| Runtime | `plugin/` | Hooks as fresh processes that fail open; state under `~/.tokeneconomizer`; side calls through `claude -p` | n/a |

Design principles worth keeping:
- **Work through what the agent already reads**: context injected at session start, tools removed through settings.
- **Count cost as billed**, with cache pricing.
- **Act only on repeated evidence.**
- **Keep every action reversible.**
- **Never block a hook on a model**: the judge runs detached, and its verdict lands on a later call.
- **Never break the prompt cache**: context is added only at a fresh start or after a tool result, and settings change only after the repo has been idle (*q* = 60 min).

---

## 2. Mechanism by mechanism: what grimoire has, and how it would fit

### 2a. Cost truth (from TokenEconomizer's trace reader and ledger)

**What grimoire has.**
- `maxOutputTokens` and the journal's `tok`: output tokens only, cumulative across the turn.
- Per-agent deltas inside a parallel block "are not separable" (`orchestrate-loop.js:2549-2556`).
- So input, cache-read and cache-write spend, the bulk of the bill on a long run, is invisible to the fuse, to `/grimoire:logs` and to `crystallize`'s routing patches ("opus spent on work that passed first time" is judged on output tokens).

**Rebuild.**
- A transcript reader, `scripts/economy/transcript.mjs`. Per main session and per `subagents/agent-<id>.jsonl` it returns:
  - calls;
  - usage **deduplicated by `message.id`**, keeping the last entry;
  - the model;
  - the agent type and label from `meta.json`;
  - the loaded tools from `prefix.json`.
- A pricing module, `pricing.mjs`, with one improvement over theirs: it weights 5-minute and 1-hour cache writes separately (Anthropic bills them at 1.25× and 2× input). Measured later in the roast: loop dispatches write 5-minute entries only, so their 1.25 weight is right for the loop. The 1-hour writes come from interactive sessions.
- **Join to the journal by label.** `meta.json.description` is the `label` the loop passes to `agent()`, so `render-logs.mjs` can attach a full bill to each dispatch event after the fact. The script itself never needs to read files.

**Shows up as:**
- effective tokens per task, per model tier, per review lens and per repo in `/grimoire:logs`;
- the same in `render-logs.mjs summary --json`, which `crystallize` reads, so routing patches rest on real cost;
- optionally a USD estimate, from a price table in config.

**Traps to copy from their spec:**
- Skip the `api-request-blob` entries, which replay every earlier call.
- Usage appears once per content block, so summing lines over-counts.
- Fold subagent files into the parent's totals.
- An unknown model falls back to a labelled default and never throws in live use.

### 2b. Loop guard for dispatched agents (from `loopguard/`)

**What grimoire has.** Guardrails at the *task* level:
- precheck, verifier, fix rounds, escalation to opus;
- late and wedged writers;
- the replanner.

Nothing watches *inside* a dispatch. An implementer can rerun the same failing test 40 times, and the loop learns of it only when the agent returns, or misses its time limit.

**Rebuild, adapted to subagents.**
- **Key each guard by the subagent's `agent_id`** from the hook input. Their key is the prompt's id, and they skip subagents. A dispatch is one turn: `SubagentStop` closes it.
- Per-agent state files (`.grimoire/economy/turns/<agent_id>.json`) also avoid a race they leave open: concurrent `PostToolUse` hooks read-modify-write one session file without a lock.
- **Port the per-call logic as is.** It is the well-tested part:
  - **State**: `SpiralState` (edits per file, error outputs, failure signatures normalised by masking hex, numbers and paths, then hashed).
  - **Test runs piped through `| tail`**: the runner's summary line decides the outcome (`runner_verdict`).
  - **Shell edits**: `sed -i`, redirects, inline Python writes and the like count as edits.
  - **The free gate**: 18 calls, and a repeated failure or 8 error outputs.
  - **`is_stuck`** and the backstop at *b* = 2.5× the envelope.
  - **The background judge**: one request slot per agent, a backoff of 5 → 20 calls between judgements, and confidence *c* ≥ 0.7.
- **The envelope**: the 90th percentile of resolved dispatches × 1.25, after 5 samples. Learn it per **(repo, agent type)**, not per repository: a scout's normal length says nothing about an implementer's.
  - Their "ended well" signal is a proxy: the turn stopped on its own, and no check failed after the last edit.
  - The loop knows better: the precheck and first-round review verdict. Feeding the envelope from the journal is a later refinement; the proxy is enough to start.
- **Redirect**: `additionalContext` on `PostToolUse`, or on `PostToolUseFailure` for a failed call, which must be answered under that event name. The text is theirs: "a materially different hypothesis; do not stop".
- **After the redirect, if still stuck.** Theirs only tells the person, who presses Esc. Nobody watches an unattended run, and the script cannot cancel an agent. The natural grimoire answer is a second context line telling the agent to **return `BLOCKED`** (or `NEEDS_CONTEXT`) with the judge's reason and what it tried. The loop's existing resolve and replan rungs then take over, and the event goes to the journal (`guard_redirect`, `guard_block`). This departs from TokenEconomizer's "never stops a turn". See decision D2.
- **The judge's model call** (superseded in the roast): no `claude -p`. The owner excludes Claude CLI calls, so the judge became a workflow subagent dispatched by the engine. See the [design spec](../specs/2026-10-30-token-economy-design.md), D4.
- **Cold start**: inert until 5 dispatches of that (repo, agent type) have resolved. **Shadow mode** (judge, log, don't redirect) should come first, so the logs show what it *would* have done before it acts.

**Latency budget.** The README warns that every agent pays the session's hooks, and that 16.6 of 29 hours of one run went to a slow third-party hook. So:
- a `PostToolUse` hook on every call of every agent must stay a few tens of milliseconds;
- no model call and no git subprocess on the hot path;
- fail open;
- the session probe (`maxToolLatencySec`) covers it like any other hook.

### 2c. Learned environment facts (the LLM-free half of micro-skills)

**What grimoire has.** Curated memory:
- capped, declarative;
- written only by `crystallize`, from a PR, reviewed by a human.

Facts like "`pytest` is missing here; `python -m pytest` works" or "`npx tsc`, not `tsc`" are exactly what memory is for. But today they reach it only if someone notices them in a review thread.

**Rebuild:**
- **Observation.** Port `observe.py`'s command segmentation and intent and form classification, the five evidence families (form repair, arg repair, env value, boundary, empty probe), and `lifecycle.py`:
  - 3 confirmations to activate;
  - contradictions weigh 5× with 0.8 decay;
  - a firing gate of ≥ 40 % over ≥ 4 exercised sessions;
  - a block of at most 4 facts and about 150 tokens;
  - a lint that refuses "skip / done / verify"-style advice.
- **Unit and key.**
  - The unit is the **dispatch**, folded once, at `SubagentStop` and `SessionEnd`.
  - Facts are keyed by `repos[].name`, from the call's working directory against `grimoire.config.json`, not by the origin URL. A grimoire project is several repositories.
- **Two consumers:**
  - **Interactive sessions**: `SessionStart` `additionalContext`, as they do.
  - **The loop**: the harness-context loader reads the active facts **once per run** and pastes them into each dispatch's brief beside the repo's memory. Freezing them per run matters, because briefs are a stable cached prefix (README, "Token economy"), and a fact block that changed mid-run would rewrite that prefix for every later dispatch.
- **The bridge to memory.** `crystallize` reads the active facts with their evidence counts. A fact that has held across runs becomes a memory-entry proposal in its PR, with the counts cited, and the machine store keeps only what is still forming. So the memory rule ("only `crystallize` writes, a human merges") stands.
- **Traps to copy:**
  - Strip `rtk [proxy]` before classifying, or nothing ever forms for us.
  - A prevented failure must still count as "fired". Otherwise a fact that works erases its own evidence.
  - A `VAR=` prefix proves nothing for the form without it.
  - Output piped through `grep` or `tail` proves nothing about the exit code.
  - `cd` carries across segments and calls.
  - `timeout N` takes its argument with it.

**Why not the paid proposer.** `distiller.py` (794 lines) asks a model every three sessions to propose facts with regex detectors. That is `crystallize`'s job, which already reads the runs with a model and hands its proposals to a human. A second, unreviewed proposer writing into context would be the "agents never write memory mid-task" rule broken by a hook.

### 2d. Tool evidence per role (from `toolprune/`)

**What grimoire has.**
- Scouts and the reviewer carry a `tools:` line. `tracker-scout` uses `disallowedTools`.
- Team agents from `templates/team-agent.md` carry neither, so every implementer dispatch loads every tool and MCP server the session has.
- In this very session that is several hundred deferred MCP tool names: Vercel, Qonto, PostHog, Figma, Blender and others.

**Rebuild, as evidence rather than enforcement:**
- **Evidence.** The economy fold records, per (repo, agent type), each tool the dispatch **loaded** (`prefix.json.toolNames` and the deferred-tool deltas) and each one it **used** (calls, subagents included).
- **Thresholds.** Their rule: a tool goes unused over *p* = 10 prompts across ≥ *m* = 2 sessions, or over *s* = 5 sessions. For dispatches, read "prompts" as dispatches.
- **Protected tools.** Their protected set (Bash, Read, Edit, Write, Grep, Glob, Agent, Skill, ToolSearch, TodoWrite, …) is never proposed, and neither is anything ever used.
- **Action.** `crystallize` gets the candidates in the journal summary and proposes, in its PR, a `disallowedTools` line (or a narrower `tools:` line) on the agent's definition, with the counts.
  - A human merges it, so the change lands between runs. That is also the only cache-safe moment: their idle-minutes rule exists because changing tools under a resumable conversation rewrites its whole cache.
  - Restoring a tool is reverting a line.
- **Interactive sessions (optional).** The same evidence can feed a `propose`-only command that prints the `permissions.deny` block for `.claude/settings.local.json`, for the user to apply.
  - It never writes the file itself.
  - Their ownership record, "kept" list, refusal on symlinks or invalid JSON, and `.git/info/exclude` entry are worth copying if we ever add an `apply`.

**Unknown, to measure in phase 1:** how much this saves under deferred tool loading. Deferred MCP tools cost their names in the system prompt, not their schemas. The cost reader can put a number on it before anything is built.

---

## 3. What we drop, and why

| TokenEconomizer piece | Decision | Why |
|---|---|---|
| Paid fact proposer (`distiller.py`) | drop | `crystallize` is the reviewed proposer; an unreviewed one breaks the memory rule |
| Repo map (`repomap*.py`, aider + tree-sitter in a second Python) | drop | the code graph (`tools/graph`) already answers *where* and *what relates*, and is ours |
| Automatic deny-list writes (`toolprune=auto`) | drop | grimoire never writes permission settings itself; proposals go through `crystallize` or the user |
| Codex capability pruning, Copilot, Pi, opencode readers and hooks | drop | grimoire is a Claude Code plugin; keep the reader interface so another agent is one file |
| `experiments/` (SWE-Bench, Web-Bench, Docker harness) | drop | measure on our own runs instead, with shadow mode and the cost reader |
| Prompt-turn guard for the main session | later | the loop's subagents first; the main session is the same code keyed differently |

---

## 4. Shape of the rebuild

```
hooks/hooks.json            + PostToolUse, PostToolUseFailure, SubagentStop (existing graph refresh stays),
                              SessionStart (facts), SessionEnd: one Node dispatcher, fails open
hooks/scripts/economy.mjs   the hot path: fold one call, maybe answer with additionalContext
scripts/economy/
  transcript.mjs            Claude Code reader: calls, usage by message id, subagents, meta, prefix tools
  pricing.mjs               effective tokens (5m / 1h cache writes apart), optional USD table
  guard/                    SpiralState, shell edits, gate, is_stuck, envelope, judge (detached)
  facts/                    observe, the five families, lifecycle, render + lint
  tools.mjs                 loaded-vs-used evidence per role, candidates for crystallize
  fold.mjs                  one finished dispatch or session → all of the above, once, under a lock
  cli.mjs                   status | facts | tools | cost (read-only views; nothing applies settings)
.grimoire/economy/          local, gitignored state (like .grimoire/graph and .grimoire/runs)
```

```json
"economy": {
  "cost": "on",
  "loopGuard": "shadow",
  "facts": "observe",
  "tools": "evidence",
  "judgeModel": "haiku",
  "sidecallBudgetUsd": null
}
```

How the pieces connect to the rest of grimoire:
- **`/grimoire:setup`** proposes the `economy` block.
- **`/grimoire:logs`** renders cost and guard events.
- **`crystallize`** reads facts and tool evidence through `render-logs.mjs summary --json`.
- **The orchestrate loop** pastes frozen facts through the harness-context loader.
- **The guard hook** needs no change: the new state lives in `.grimoire/`, which it does not protect, and agents never edit it.

---

## 5. Suggested slices

Each slice is independently shippable, and each makes the next measurable.

1. **Cost truth.**
   - Transcript reader, pricing, a per-dispatch bill joined to the journal by label.
   - Cost columns in `/grimoire:logs` and in the summary `crystallize` reads.
   - No hooks and no behaviour change. It is the baseline every later slice is judged against.
2. **Loop guard in shadow mode.**
   - Hooks fold calls per subagent.
   - The judge runs detached and journals "would redirect".
   - Nothing is injected. The logs show precision on real runs.
3. **Loop guard on.**
   - The redirect, then the `BLOCKED` return wired into the resolve rung.
   - Opt-in per project at first.
4. **Environment facts.**
   - Observe and lifecycle.
   - Inject at `SessionStart` and through harness-context, frozen per run.
   - Promotion proposals in `crystallize`.
5. **Tool evidence.**
   - Loaded-vs-used per role.
   - `crystallize` proposes `disallowedTools`.
   - An optional `propose` command for interactive sessions.

---

## 6. Decisions that are yours (for the roast)

- **D1. Do learned facts reach context before a human sees them?**
  - **Option A (recommended).** Yes, as a separate machine store: local, capped at 4 facts and about 150 tokens, deterministic, retired automatically on contradiction, frozen per run. `crystallize` promotes durable ones to memory through its reviewed PR.
  - **Option B.** No: facts are only candidates in `crystallize`'s report. This is stricter, but it delays every fact to the next reviewed PR.
- **D2. May the loop guard tell a dispatched agent to stop and return `BLOCKED`?**
  - TokenEconomizer never stops a turn. In an unattended loop nobody is there to press Esc, and the resolve and replan rungs already exist for a blocked agent.
  - Recommended: one redirect, then `BLOCKED`, with the judge's reason in the journal.
- **D3. Defaults.**
  - Recommended: `cost` on everywhere.
  - `loopGuard: shadow` for the first release, `on` once a few runs show its verdicts hold.
  - `facts: observe` (learn, don't inject).
  - `tools: evidence`.
- **D4. The judge's spend.** It is a haiku call under the user's login, and only gated turns pay it. Should it have its own cap (`sidecallBudgetUsd`), or count against `maxOutputTokens`?

---

## 7. Facts checked, and what is still unknown

**Checked on 2026-10-30, on this machine's Claude Code transcripts:**
- Subagent transcripts live at `~/.claude/projects/<slug>/<sessionId>/subagents/agent-<id>.jsonl`.
  - Each has a `meta.json` with `agentType`, `description` (the dispatch label) and `model`.
  - Each has a `prefix.json` whose `state.toolNames` lists the tools that agent loaded.
- Usage carries `cache_creation.ephemeral_5m_input_tokens` and `ephemeral_1h_input_tokens`. This session writes 1-hour entries only.
- Agent definitions accept `disallowedTools`, which `tracker-scout` already uses.
- The hook input inside a subagent carries `agent_type`, which `hooks/README.md` relies on for the guard.

**To verify in a spike before slice 2 or 3.** These are facts we can find, not decisions:
- Does `PostToolUse` `additionalContext` reach the *subagent's* context (not the parent's) on the current Claude Code? TokenEconomizer never tested this, because it skips subagents.
- ~~Does `SubagentStart` accept `additionalContext`?~~ Settled in the roast: yes. The hooks docs say it is added to the subagent's context before its first prompt.
- How long does a Node hook take per call under a parallel loop, measured with the session probe?
- Does rtk-condensed output keep the error lines that the failure signature hashes? Their signature takes the first line matching the error regex.

**Attribution.** Files that port TokenEconomizer's logic carry a header naming the source file and commit and the Apache-2.0 licence, and the CHANGELOG entry credits it, the way the architecture skill credits archify.
