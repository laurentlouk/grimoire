---
name: implement
description: Implement one tracker issue end to end through the team agent that owns its repository. Use to build a single vertical-slice issue from to-issues, test-first, committed, and opened as a PR. Stops at the PR.
---

# Implement one issue

Implement exactly one issue. Dispatch the team agent that owns the repository it touches (from `AGENTS.md`, via `launch-agent`, with its memory pasted in). A specialist from the roster (`migration-engineer`, `test-engineer`) builds instead only when the issue is squarely its kind and the project enables it for that repository. It gets the owner's memory too, because those facts are about the repository. Within a slice, repositories run in parallel; within a repository, tasks run one at a time in dependency order. Never two implementers on one checkout.

Build test-first per `tdd`: red, green, refactor, one behaviour at a time, through the public seam, with independent expected values. Assert the full output, not its shape, and type everything fully. Finish the whole change, not the happy path: handle the edge cases and failure modes it introduces, verify end to end, and delete the code it obsoletes.

Before declaring done, run the repository's exact CI checks, not a lenient local variant: read the CI workflow and run its commands as written (lint with zero warnings, typecheck, the full test suite in CI mode). A warning CI would reject is a failure.

**Gates the orchestrator owns.** If the repository has an expensive or machine-global gate (an end-to-end suite, a device or emulator test), the implementer never runs it and never opens that repository's PR. It finishes the whole change, makes the final commit, and reports `DONE_PENDING_GATE`; the orchestrator runs the gate once on the final committed tree and, on green, opens the PR. Launch the gate only when nothing is left to fix: any commit after it costs a full re-run.

The implementer explores before asking and never guesses: a fact discoverable in the design artifacts, the docs, the code, schemas, contracts, config or git history is looked up, never assumed. It has no interactive channel. If, after that exploration, the requirement is still unclear, it returns `NEEDS_CONTEXT` with one specific question that says what it checked and what is still unknown; a read-only scout answers it from the codebase when it can, and only genuine product, priority or trade-off decisions reach the user.

**Waiting and resuming.** The implementer never waits more than 4 minutes in one shell call: a long command runs in the background and is waited on in chunks, because an agent's prompt cache expires after 5 minutes and the turn after a longer wait re-writes its whole context. Each fix round is a resume of the same implementer, and its context grows with every round. After about five resumes, or once it has been compacted, start a fresh implementer from a short handoff instead: the branch, the head, what is done, the open findings. One implementer resumed thirteen times reached a context of about a million tokens, re-read on every turn.

**Execution policy.** Resolve the issue's profile from `workflows/policies.md` ("In a session") before building: its `grimoire:policy/*` label, else the repo's `policy` in `grimoire.config.json`, else the config's `policy`; with none, `fast` unless a floor applies or a raise does. The floors and raises are the router's, not a paraphrase: a file on `strictPaths` (the repo's own `strictPaths` included), an `infra` repo, a migration, a blocking relation on another repo's issue (declared, or found while building: this change consumes what another repo's open issue adds) → `strict`; no declared files, more than three files, a design-heavy change → `balanced`. With no declared files, list the files the change will touch and classify those. After the build, classify what actually changed: a floor hit, or an auth check added, removed or changed in the diff whatever the file is named, makes it `strict` before review. Never lower. `strict` builds on opus. Say the profile and why in the PR description, the signal that set it included; `review` applies the same one.

Commit to the issue's branch, open one PR per repository titled with the ticket, update the issue's status. Stop at the PR. **Next:** `review`.
