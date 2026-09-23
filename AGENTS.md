# AGENTS.md: the roster

Source of truth for the agents the orchestrator dispatches. Each has a definition in `agents/<name>.md` (the file the runtime launches); this file says who they are, how they are configured, and how the harness learns between runs. If the two disagree, the definition wins; fix the drift.

## The model: a main agent that learns, plus two tiers

The orchestrator is the main agent. It runs the pipeline (`roast` → `to-plan` → `to-issues` → build ⇄ review → PR → `crystallize`), holds the big picture, and learns from one run to the next through three stores, none of which is chat history:

| Store | What | Where | Written by |
| --- | --- | --- | --- |
| **Memory** (facts) | small, capped, always-injected declarative facts: one shared store, one per team agent | `memory/harness.md`, `memory/agents/<agent>.md` (rules in `memory/README.md`) | `crystallize` only |
| **Skills** (procedures) | how to do recurring things, patched or created after each PR | `skills/<name>/SKILL.md` + `evals/` | `crystallize` (eval-gated), humans |
| **Docs** (team truth) | conventions, domain references, specs, plans, crystallize reports | `docs/` | `roast` (drift fixes), `crystallize`, humans |

Agents never write memory mid-task. The lesson is extracted afterwards by `crystallize`, when the PR's review threads exist as signal.

```
                 ORCHESTRATOR (main agent)
                 runs the pipeline · dispatches · learns
                          │
          ┌───────────────┴────────────────┐
  TEAM AGENTS (persistent roles)     SCOUTS (one-shot, read-only)
  one per repository; continuity     ask → fact → gone
  via artifacts + memory             • codebase-scout    (search)
  • <repo>-engineer …                • reference-scout   (open-source best practice)
  SPECIALISTS (opt-in per repo)      • reviewer          (diff vs task)
  same contract, narrower lens       • tracker-scout     (ticket context)
  • migration-engineer               • design-scout      (design facts)
  • test-engineer                    • contract-checker  (cross-repo contracts)
                                     • security-scout    (authn/authz, secrets, input, advisories)
                                     • perf-scout        (where time/memory goes)
```

**Explore before asking; don't guess — every agent, every tier.** If a fact is discoverable in the docs, the code, schemas, contracts, config or git history, the agent finds it before asking, and never states a discoverable fact as a guess. Only decisions the owner holds (product/UX calls, cost or vendor trade-offs, priorities, context outside the codebase) travel back as a question, and an inconclusive search says what was checked and what is still unknown. The rule lives in the definitions themselves (`templates/team-agent.md`, every `agents/*.md`, the loop's briefs and dispatch header, and the skills that ask), so a project does not have to add it to its own instructions.

**Decision rule per step.** Need a fact with no follow-up → scout (parallel when independent). Advancing a plan task with a commit → team agent. Trivial and cross-cutting → do it inline. Reviewing a diff → the `reviewer` scout; you own the gate, never review inline, never let the implementer review its own work.

**The selector.** In the loop, the hydrate step picks an implementer and a model tier per task, from the task's tags, declared files, slice and risk: the candidates are the repo's owning team agent plus the specialists enabled for that repo. It logs why. The engine validates the choice against this roster; an unknown or not-enabled agent falls back to the repo's owner, and the fallback is logged. The model escalates to opus on the second fix round of a task or when the task was replanned. When an implementer returns `NEEDS_CONTEXT`, the resolve rung picks the scout by the question's shape (where/how → `codebase-scout`, contract → `contract-checker`, security → `security-scout`, performance → `perf-scout`, …).

## Team agents

Create one from `templates/team-agent.md` per repository. Interactive dispatches run one implementer per repository at a time; the loop relaxes this with worktree lanes when declared files are disjoint. Never two agents on one checkout.

| Agent | Repo | Default model | Owns |
| --- | --- | --- | --- |
| `<repo>-engineer` | `<repo>` | sonnet (opus in unattended runs) | the skills for that stack |

## Scouts

| Scout | Purpose | Model |
| --- | --- | --- |
| `codebase-scout` | where / how does X work today | haiku |
| `reference-scout` | how do credible open-source projects using our stack do this; never a stack change | sonnet |
| `reviewer` | spec or quality verdict on a diff | sonnet |
| `tracker-scout` | what a ticket actually requires: criteria, status, links, scope-changing comments | haiku |
| `design-scout` | components, tokens, measurements, assets, states from the design source | haiku |
| `contract-checker` | do both sides of a cross-repo contract agree; release ordering | sonnet |
| `security-scout` | one security question: authn/authz path, secret handling, input validation, dependency advisories | sonnet |
| `perf-scout` | where time or memory goes on a path; measured apart from inferred | sonnet |

## Specialists

Implementers with a narrower lens than the repo's owner, dispatched into that repo with the same brief and the same return contract (`DONE` / `DONE_WITH_CONCERNS` / `NEEDS_CONTEXT` / `BLOCKED`, `baseSha` / `commits` / `headSha`). They follow the repo's own conventions. Off by default: enable one per repo in `grimoire.config.json`, e.g. `"specialists": [{ "agent": "migration-engineer", "repos": ["api"] }]`.

| Agent | Default model | Owns |
| --- | --- | --- |
| `migration-engineer` | sonnet (loop overrides per task) | schema and data migrations, wide changes: expand/contract, reversible steps, idempotent backfills, lock safety, deploy ordering |
| `test-engineer` | sonnet (loop overrides per task) | getting untested code under test: highest seam, characterization tests, the red step |

## Adding an agent
1. Write `agents/<name>.md` (frontmatter `name`, `description`, optional `tools`, `model`; body is the system prompt).
2. Add its row here.
3. Team agent, specialist or reviewer: create `memory/agents/<name>.md` and add the "Your memory (read it first)" section to its definition.
4. Add its evals.

## When to add an agent
Only when telemetry shows a recurring task kind failing on the same lens, run after run; one bad PR is a memory entry or a skill patch, not an agent. `crystallize` proposes it; a human approves. Each new agent needs its definition, its row here, its memory file (implementers and the reviewer) and its evals; the drift check in CI (`scripts/check-drift.mjs`) fails the build when any of them is missing.
