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
  via artifacts + memory             • codebase-scout   (search)
  • <repo>-engineer …                • reference-scout  (open-source best practice)
                                     • reviewer         (diff vs task)
                                     • add your own: tracker, design, contracts
```

**Decision rule per step.** Need a fact with no follow-up → scout (parallel when independent). Advancing a plan task with a commit → team agent. Trivial and cross-cutting → do it inline. Reviewing a diff → the `reviewer` scout; you own the gate, never review inline, never let the implementer review its own work.

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

## Adding an agent
1. Write `agents/<name>.md` (frontmatter `name`, `description`, optional `tools`, `model`; body is the system prompt).
2. Add its row here.
3. Team agent or reviewer: create `memory/agents/<name>.md` and add the "Your memory (read it first)" section to its definition.
