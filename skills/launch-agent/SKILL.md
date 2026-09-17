---
name: launch-agent
description: Dispatch a team agent or a read-only scout from the project's AGENTS.md roster with its settled configuration, including its memory. Use when the user says "start the backend agent", "send a scout to find X", "launch the reviewer on this diff", or whenever a skill needs to fire an agent and wants the roster's config filled in rather than hand-written.
---

# Launch an agent from the roster

`AGENTS.md` is the source of truth for who can be dispatched, with which model, which tools, and which brief. Read it and dispatch from it instead of improvising a prompt.

## Two tiers

- **Team agents** own a repository and produce tracked changes: commits, PRs. They carry no chat history; continuity lives in artifacts (the spec, the plan, the repo, the tracker) and in their memory store.
- **Scouts** answer one question and are gone: codebase search, contract drift, ticket context, design facts, open-source reference patterns. Read-only, no follow-up. If you want to ask again, the work belongs to a team agent.

## Inject the memory

Before dispatching a team agent or the reviewer, read its store at `memory/agents/<agent>.md` (or `.claude/memory/agents/<agent>.md`) and paste its entries verbatim under a `## Your memory` heading at the top of the brief. The agent definition also tells it to read the file; pasting makes the read unconditional. Scouts have no memory. Never ask an agent to write memory; `crystallize` does that, after the PR.

## The brief

Paste the full task text, never "go read the plan". Add the relevant spec excerpt, the files to touch, the success criteria, and the ticket. Remind a team agent that it has no interactive channel: if the requirement is still unclear after exploring, it returns `NEEDS_CONTEXT` with one specific question rather than guessing. It commits incrementally so a cut-off dispatch resumes instead of restarting, and ends with one of `DONE`, `DONE_WITH_CONCERNS`, `NEEDS_CONTEXT`, `BLOCKED`. If the repo has a gate the orchestrator owns (an end-to-end suite, a device test), tell the agent not to run it and not to open the PR.

## Parallelism

Independent scouts go out in one message so they run together. Never put two agents on the same checkout; parallel work inside one repository needs separate worktrees.
